import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js'
import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import { v4 as uuidv4 } from 'uuid'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { getDatabase, debounceSave } from '../database'
import { toolRegistry } from '../agents/tools/registry'

export type McpTransport = 'stdio' | 'http' | 'sse' | 'cli'
export type McpStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpServerConfig {
  id: string
  name: string
  description?: string | null
  icon?: string | null
  transport: McpTransport
  command?: string | null
  args?: string[] | null
  cwd?: string | null
  env?: Record<string, string> | null
  url?: string | null
  enabled: boolean
  auto_start: boolean
}

export interface McpServerRow extends McpServerConfig {
  status: McpStatus
  last_error: string | null
  last_connected_at: string | null
  tool_count: number
  created_at: string
  updated_at: string
}

export interface McpToolInfo {
  name: string
  description: string
}

interface ConnectionEntry {
  client: Client | null
  tools: DynamicStructuredTool[]
  config: McpServerConfig
  status: McpStatus
  lastError: string | null
  pingTimer: NodeJS.Timeout | null
}

const PING_INTERVAL_MS = 60_000
const CLI_DEFAULT_TIMEOUT_MS = 120_000
const CLI_MAX_OUTPUT_CHARS = 50_000
const SERVER_COLUMNS =
  'id, name, description, icon, transport, command, args, cwd, env, url, enabled, auto_start, status, last_error, last_connected_at, tool_count, created_at, updated_at'

function safeParse<T>(json: string | null | undefined, defaultValue: T): T {
  if (!json) return defaultValue
  try {
    return JSON.parse(json) as T
  } catch {
    return defaultValue
  }
}

function rowToServer(row: any[]): McpServerRow {
  return {
    id: row[0],
    name: row[1],
    description: row[2],
    icon: row[3],
    transport: row[4] as McpTransport,
    command: row[5],
    args: safeParse<string[]>(row[6], []),
    cwd: row[7],
    env: safeParse<Record<string, string>>(row[8], {}),
    url: row[9],
    enabled: !!row[10],
    auto_start: !!row[11],
    status: (row[12] as McpStatus) || 'disconnected',
    last_error: row[13],
    last_connected_at: row[14],
    tool_count: row[15] || 0,
    created_at: row[16],
    updated_at: row[17]
  }
}

// 轻量 JSON Schema → Zod 转换器
// 覆盖 MCP 工具常见的 schema 类型：string/number/integer/boolean/array/object/enum
// 未识别的类型回退到 z.any()，避免 LangChain bindTools 转换失败
function jsonSchemaToZod(schema: any): z.ZodTypeAny {
  if (!schema || typeof schema !== 'object') {
    return z.any()
  }

  // $ref 解析（CATIA 工具不使用 $ref，但安全处理）
  if (schema.$ref) {
    return z.any()
  }

  // enum
  if (Array.isArray(schema.enum) && schema.enum.length > 0) {
    const enumValues = schema.enum.filter((v: any) => typeof v === 'string') as [string, ...string[]]
    if (enumValues.length > 0) {
      return z.enum(enumValues)
    }
    return z.any()
  }

  // anyOf / oneOf
  if (Array.isArray(schema.anyOf) && schema.anyOf.length > 0) {
    const variants = schema.anyOf.map((s: any) => jsonSchemaToZod(s))
    return z.union(variants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }
  if (Array.isArray(schema.oneOf) && schema.oneOf.length > 0) {
    const variants = schema.oneOf.map((s: any) => jsonSchemaToZod(s))
    return z.union(variants as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  switch (schema.type) {
    case 'string':
      return z.string()
    case 'number':
    case 'integer':
      return z.number()
    case 'boolean':
      return z.boolean()
    case 'array':
      return z.array(jsonSchemaToZod(schema.items))
    case 'object': {
      const props = schema.properties || {}
      const requiredList: string[] = Array.isArray(schema.required) ? schema.required : []
      const shape: Record<string, z.ZodTypeAny> = {}
      for (const [key, subSchema] of Object.entries(props)) {
        const zodField = jsonSchemaToZod(subSchema)
        // OpenAI structured outputs 要求所有字段必填，可选字段用 .nullable() 表达
        // （.optional() 会让字段从 required 中移除，触发 SDK 警告/未来报错）
        shape[key] = requiredList.includes(key) ? zodField : zodField.nullable()
      }
      return z.object(shape)
    }
    default:
      // 没有 type 但有 properties（部分 MCP 工具这样写）→ 按 object 处理
      if (schema.properties) {
        const props = schema.properties
        const requiredList: string[] = Array.isArray(schema.required) ? schema.required : []
        const shape: Record<string, z.ZodTypeAny> = {}
        for (const [key, subSchema] of Object.entries(props)) {
          const zodField = jsonSchemaToZod(subSchema)
          shape[key] = requiredList.includes(key) ? zodField : zodField.nullable()
        }
        return z.object(shape)
      }
      return z.any()
  }
}

// 把 MCP 工具的 inputSchema 转换为 zod schema，并包装成 DynamicStructuredTool
// 工具名必须符合 OpenAI function name pattern: ^[a-zA-Z0-9_-]+$
// 用双下划线分隔 serverId 和工具名（不能用冒号）
function createMcpTool(
  serverId: string,
  serverName: string,
  mcpTool: { name: string; description?: string; inputSchema: any },
  client: Client
): DynamicStructuredTool {
  const wrappedName = `mcp__${serverId}__${mcpTool.name}`
  const zodSchema = jsonSchemaToZod(mcpTool.inputSchema) as z.ZodObject<any>

  return new DynamicStructuredTool({
    name: wrappedName,
    description: `[${serverName}] ${mcpTool.description || mcpTool.name}`,
    schema: zodSchema,
    func: async (input: any): Promise<string> => {
      try {
        const result = await client.callTool({ name: mcpTool.name, arguments: input })
        // MCP callTool 返回 { content: [{ type: 'text', text: '...' }, ...], isError? }
        const content = (result as any)?.content
        if (Array.isArray(content)) {
          const text = content
            .map((c: any) => {
              if (c?.type === 'text') return c.text
              if (c?.type === 'image') return `[image: ${c.mimeType || 'unknown'}]`
              if (c?.type === 'resource') return `[resource: ${c.uri || 'unknown'}]`
              return ''
            })
            .filter(Boolean)
            .join('\n')
          if ((result as any)?.isError) {
            return `工具执行错误: ${text || '未知错误'}`
          }
          return text || JSON.stringify(result)
        }
        return JSON.stringify(result)
      } catch (err: any) {
        return `MCP 工具调用失败: ${err.message || String(err)}`
      }
    }
  })
}

// 执行 CLI 命令：JSON 写入 stdin，收集 stdout/stderr 返回
// 不用 shell，agent 输入只走 stdin，避免命令注入
function runCliCommand(
  config: McpServerConfig,
  input: unknown
): Promise<string> {
  return new Promise((resolve) => {
    const timeoutMs = Number(config.env?.TOOL_TIMEOUT_MS) || CLI_DEFAULT_TIMEOUT_MS
    const env: Record<string, string> = {
      PYTHONUNBUFFERED: '1',
      PYTHONIOENCODING: 'utf-8',
      ...(process.env as Record<string, string>),
      ...(config.env || {})
    }
    delete env.TOOL_TIMEOUT_MS

    let child
    try {
      child = spawn(config.command!, config.args || [], {
        cwd: config.cwd || undefined,
        env,
        windowsHide: true
      })
    } catch (err: any) {
      resolve(`CLI 启动失败: ${err.message || String(err)}`)
      return
    }

    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (text: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(text)
    }
    const timer = setTimeout(() => {
      try {
        child.kill()
      } catch {
        // ignore
      }
      finish(`CLI 执行超时（${Math.round(timeoutMs / 1000)}s），进程已终止\n已收集输出:\n${stdout}`)
    }, timeoutMs)

    child.stdout.on('data', (d) => {
      stdout += d.toString()
      if (stdout.length > CLI_MAX_OUTPUT_CHARS) {
        stdout = stdout.slice(0, CLI_MAX_OUTPUT_CHARS) + '\n...[输出过长已截断]'
        try {
          child.kill()
        } catch {
          // ignore
        }
      }
    })
    child.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    child.on('error', (err) => {
      finish(`CLI 启动失败: ${err.message}`)
    })
    child.on('close', (code) => {
      const out = stdout.trim()
      const errOut = stderr.trim()
      if (code === 0) {
        finish(out || '(命令执行成功，无输出)')
      } else {
        finish(
          `CLI 退出码 ${code}\n${errOut ? `stderr:\n${errOut}\n` : ''}${out ? `stdout:\n${out}` : ''}`.trim()
        )
      }
    })

    // 写入 JSON 输入并关闭 stdin，通知程序输入结束
    try {
      child.stdin.write(JSON.stringify(input ?? {}))
      child.stdin.end()
    } catch (err: any) {
      finish(`CLI 输入写入失败: ${err.message}`)
    }
  })
}

// CLI 传输：一条服务器配置 = 一个 CLI 工具
// Agent 传入 JSON 对象，经 stdin 交给命令行程序，stdout 作为工具结果
function createCliTool(config: McpServerConfig): DynamicStructuredTool {
  const wrappedName = `mcp__${config.id}__run`
  return new DynamicStructuredTool({
    name: wrappedName,
    description:
      `[${config.name}] ${config.description || config.command || '命令行工具'}` +
      '（参数以 JSON 对象形式传入，通过 stdin 交给命令行程序，返回其 stdout 输出）',
    schema: z.object({
      input: z
        .record(z.any())
        .describe('传给命令行程序的 JSON 参数对象，键值由该程序的接口约定决定')
    }),
    func: async ({ input }: { input: Record<string, unknown> }): Promise<string> => {
      return await runCliCommand(config, input)
    }
  })
}

class McpConnectionManagerImpl {
  private connections: Map<string, ConnectionEntry> = new Map()

  async startAll(): Promise<void> {
    let servers: McpServerRow[] = []
    try {
      servers = this.listEnabledServersFromDB()
    } catch (err) {
      console.warn('[MCP] Failed to load servers from DB:', err)
      return
    }
    console.log(`[MCP] Starting ${servers.length} enabled MCP servers`)
    for (const server of servers) {
      try {
        await this.connect(server.id)
      } catch (err) {
        console.warn(`[MCP] Failed to start server "${server.name}":`, err)
      }
    }
  }

  async stopAll(): Promise<void> {
    const ids = Array.from(this.connections.keys())
    for (const id of ids) {
      try {
        await this.disconnect(id)
      } catch (err) {
        console.warn(`[MCP] Failed to disconnect ${id}:`, err)
      }
    }
  }

  async connect(serverId: string): Promise<{ toolCount: number }> {
    if (this.connections.has(serverId)) {
      await this.disconnect(serverId)
    }

    const config = this.getServerFromDB(serverId)
    if (!config) throw new Error(`MCP 服务器 ${serverId} 不存在`)

    this.updateServerStatus(serverId, 'connecting', null, 0)

    // CLI 传输：无 MCP 协议连接，直接注册一个 stdin-JSON 工具
    if (config.transport === 'cli') {
      try {
        if (!config.command) throw new Error('cli 传输需要 command 字段')
        const tool = createCliTool(config)
        toolRegistry.register(tool.name, tool as unknown as Tool, {
          description: config.description || '',
          source: 'mcp',
          serverId,
          serverName: config.name
        })
        this.connections.set(serverId, {
          client: null,
          tools: [tool],
          config,
          status: 'connected',
          lastError: null,
          pingTimer: null
        })
        this.updateServerStatus(serverId, 'connected', null, 1)
        console.log(`[MCP] CLI tool "${config.name}" registered`)
        return { toolCount: 1 }
      } catch (err: any) {
        this.updateServerStatus(serverId, 'error', err.message || String(err), 0)
        throw err
      }
    }

    let transport: Transport
    let client: Client
    try {
      transport = this.createTransport(config)
    } catch (err: any) {
      this.updateServerStatus(serverId, 'error', `传输初始化失败: ${err.message}`, 0)
      throw err
    }

    client = new Client(
      { name: 'aeromind', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    )

    try {
      await client.connect(transport)
    } catch (err: any) {
      const msg = err.message || String(err)
      this.updateServerStatus(serverId, 'error', `连接失败: ${msg}`, 0)
      try {
        await (client as any).close?.()
      } catch {
        // ignore
      }
      throw err
    }

    try {
      const toolsResult = await client.listTools()
      const mcpTools = toolsResult.tools || []
      const wrappedTools: DynamicStructuredTool[] = []

      for (const mcpTool of mcpTools) {
        const wrapped = createMcpTool(serverId, config.name, mcpTool, client)
        wrappedTools.push(wrapped)
        // ToolRegistry key 与 tool.name 一致，方便 stream-handler 通过 tool.name 查找
        toolRegistry.register(wrapped.name, wrapped as unknown as Tool, {
          description: mcpTool.description || '',
          source: 'mcp',
          serverId,
          serverName: config.name
        })
      }

      const entry: ConnectionEntry = {
        client,
        tools: wrappedTools,
        config,
        status: 'connected',
        lastError: null,
        pingTimer: this.startPing(serverId)
      }
      this.connections.set(serverId, entry)

      this.updateServerStatus(serverId, 'connected', null, wrappedTools.length)
      console.log(
        `[MCP] Connected to "${config.name}", ${wrappedTools.length} tools registered`
      )
      return { toolCount: wrappedTools.length }
    } catch (err: any) {
      const msg = err.message || String(err)
      this.updateServerStatus(serverId, 'error', `工具列表获取失败: ${msg}`, 0)
      try {
        await (client as any).close?.()
      } catch {
        // ignore
      }
      throw err
    }
  }

  async disconnect(serverId: string): Promise<void> {
    const entry = this.connections.get(serverId)
    if (!entry) {
      this.updateServerStatus(serverId, 'disconnected', null, 0)
      return
    }

    if (entry.pingTimer) {
      clearInterval(entry.pingTimer)
      entry.pingTimer = null
    }

    try {
      await entry.client?.close?.()
    } catch (err) {
      console.warn(`[MCP] Error closing client for ${serverId}:`, err)
    }

    toolRegistry.unregisterByServer(serverId)
    this.connections.delete(serverId)
    this.updateServerStatus(serverId, 'disconnected', null, 0)
  }

  async reconnect(serverId: string): Promise<{ toolCount: number }> {
    await this.disconnect(serverId)
    return await this.connect(serverId)
  }

  async testConnection(
    config: McpServerConfig
  ): Promise<{
    success: boolean
    toolCount: number
    tools: McpToolInfo[]
    error?: string
  }> {
    const tempId = config.id || `temp-${uuidv4()}`

    // CLI 传输：只校验命令可解析，不实际执行（避免副作用）
    if (config.transport === 'cli') {
      if (!config.command) {
        return { success: false, toolCount: 0, tools: [], error: 'cli 传输需要 command 字段' }
      }
      const probeError = await this.probeCliCommand(config)
      if (probeError) {
        return { success: false, toolCount: 0, tools: [], error: probeError }
      }
      return {
        success: true,
        toolCount: 1,
        tools: [{ name: 'run', description: config.description || config.command }]
      }
    }

    let transport: Transport
    let client: Client
    try {
      transport = this.createTransport({ ...config, id: tempId })
    } catch (err: any) {
      return { success: false, toolCount: 0, tools: [], error: `传输初始化失败: ${err.message}` }
    }

    client = new Client(
      { name: 'aeromind-test', version: '1.0.0' },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    )

    try {
      await client.connect(transport)
      const toolsResult = await client.listTools()
      const mcpTools = toolsResult.tools || []
      const toolInfos: McpToolInfo[] = mcpTools.map((t: any) => ({
        name: t.name,
        description: t.description || ''
      }))
      return { success: true, toolCount: mcpTools.length, tools: toolInfos }
    } catch (err: any) {
      return {
        success: false,
        toolCount: 0,
        tools: [],
        error: err.message || String(err)
      }
    } finally {
      try {
        await (client as any).close?.()
      } catch {
        // ignore
      }
    }
  }

  listTools(serverId: string): McpToolInfo[] {
    return toolRegistry.listByServer(serverId).map((info) => ({
      name: info.name,
      description: info.description
    }))
  }

  getStatus(
    serverId: string
  ): { status: McpStatus; lastError: string | null; toolCount: number } {
    const entry = this.connections.get(serverId)
    if (entry) {
      return {
        status: entry.status,
        lastError: entry.lastError,
        toolCount: entry.tools.length
      }
    }
    const config = this.getServerFromDB(serverId)
    return {
      status: config?.status || 'disconnected',
      lastError: config?.last_error || null,
      toolCount: config?.tool_count || 0
    }
  }

  isConnected(serverId: string): boolean {
    const entry = this.connections.get(serverId)
    return !!entry && entry.status === 'connected'
  }

  private createTransport(config: McpServerConfig): Transport {
    if (config.transport === 'stdio') {
      if (!config.command) {
        throw new Error('stdio 传输需要 command 字段')
      }
      const env: Record<string, string> = {
        PYTHONUNBUFFERED: '1',
        PYTHONIOENCODING: 'utf-8',
        ...(process.env as Record<string, string>),
        ...(config.env || {})
      }
      const options: any = {
        command: config.command,
        args: config.args || [],
        env
      }
      if (config.cwd) options.cwd = config.cwd
      if (process.platform === 'win32') {
        options.spawn = { windowsHide: true }
      }
      return new StdioClientTransport(options)
    }
    if (config.transport === 'sse') {
      if (!config.url) {
        throw new Error('sse 传输需要 url 字段')
      }
      return new SSEClientTransport(new URL(config.url))
    }
    if (config.transport === 'http') {
      if (!config.url) {
        throw new Error('http 传输需要 url 字段')
      }
      return new StreamableHTTPClientTransport(new URL(config.url))
    }
    throw new Error(`不支持的传输类型: ${config.transport}`)
  }

  // 探测 CLI 命令是否可解析（显式路径查文件，裸命令查 PATH），不实际执行
  private async probeCliCommand(config: McpServerConfig): Promise<string | null> {
    const cmd = config.command!
    if (/[\\/]/.test(cmd)) {
      const fullPath = path.isAbsolute(cmd)
        ? cmd
        : path.resolve(config.cwd || process.cwd(), cmd)
      return fs.existsSync(fullPath) ? null : `命令文件不存在: ${fullPath}`
    }
    return await new Promise((resolve) => {
      const probe = process.platform === 'win32' ? 'where' : 'which'
      const p = spawn(probe, [cmd], { windowsHide: true })
      p.on('close', (code) =>
        resolve(code === 0 ? null : `PATH 中未找到命令: ${cmd}`)
      )
      p.on('error', (err) => resolve(`命令探测失败: ${err.message}`))
    })
  }

  private startPing(serverId: string): NodeJS.Timeout {
    return setInterval(async () => {
      const entry = this.connections.get(serverId)
      if (!entry || entry.status !== 'connected' || !entry.client) return
      try {
        await entry.client.listTools()
      } catch (err: any) {
        console.warn(
          `[MCP] Ping failed for "${entry.config.name}", attempting reconnect:`,
          err.message
        )
        entry.status = 'error'
        entry.lastError = err.message || String(err)
        this.updateServerStatus(serverId, 'error', entry.lastError, entry.tools.length)
        try {
          await this.reconnect(serverId)
        } catch (reconnectErr: any) {
          console.error(`[MCP] Reconnect failed for "${entry.config.name}":`, reconnectErr)
        }
      }
    }, PING_INTERVAL_MS)
  }

  // ============ DB 操作 ============

  private getServerFromDB(serverId: string): McpServerRow | null {
    const db = getDatabase()
    const results = db.exec(`SELECT ${SERVER_COLUMNS} FROM mcp_servers WHERE id = ?`, [serverId])
    if (!results[0] || !results[0].values[0]) return null
    return rowToServer(results[0].values[0])
  }

  private listEnabledServersFromDB(): McpServerRow[] {
    const db = getDatabase()
    const results = db.exec(
      `SELECT ${SERVER_COLUMNS} FROM mcp_servers WHERE enabled = 1 AND auto_start = 1`
    )
    if (!results[0]) return []
    return results[0].values.map(rowToServer)
  }

  private updateServerStatus(
    serverId: string,
    status: McpStatus,
    lastError: string | null,
    toolCount: number
  ): void {
    try {
      const db = getDatabase()
      db.run(
        `UPDATE mcp_servers SET status = ?, last_error = ?, tool_count = ?, last_connected_at = CASE WHEN ? = 'connected' THEN datetime('now') ELSE last_connected_at END, updated_at = datetime('now') WHERE id = ?`,
        [status, lastError, toolCount, status, serverId]
      )
      debounceSave()
    } catch (err) {
      console.warn(`[MCP] Failed to update status for ${serverId}:`, err)
    }
  }
}

export const mcpManager = new McpConnectionManagerImpl()
