import { ipcMain } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getDatabase, debounceSave } from '../database'
import { mcpManager, type McpServerConfig, type McpServerRow, type McpTransport } from '../mcp/manager'
import { MCP_TEMPLATES, detectPythonPath, detectCatiaServerPath, validateCatiaServerPath, detectAbaqusServerPath, validateAbaqusServerPath, type McpTemplate } from '../mcp/templates'

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
    status: (row[12] as McpServerRow['status']) || 'disconnected',
    last_error: row[13],
    last_connected_at: row[14],
    tool_count: row[15] || 0,
    created_at: row[16],
    updated_at: row[17]
  }
}

function listServersFromDB(): McpServerRow[] {
  const db = getDatabase()
  const results = db.exec(`SELECT ${SERVER_COLUMNS} FROM mcp_servers ORDER BY created_at ASC`)
  if (!results[0]) return []
  return results[0].values.map(rowToServer)
}

function getServerFromDB(id: string): McpServerRow | null {
  const db = getDatabase()
  const results = db.exec(`SELECT ${SERVER_COLUMNS} FROM mcp_servers WHERE id = ?`, [id])
  if (!results[0] || !results[0].values[0]) return null
  return rowToServer(results[0].values[0])
}

function insertServer(params: McpServerConfig & { status?: string }): McpServerRow {
  const db = getDatabase()
  const id = params.id || `mcp-${uuidv4()}`
  db.run(
    `INSERT INTO mcp_servers (id, name, description, icon, transport, command, args, cwd, env, url, enabled, auto_start, status, tool_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [
      id,
      params.name,
      params.description || null,
      params.icon || '🔌',
      params.transport,
      params.command || null,
      JSON.stringify(params.args || []),
      params.cwd || null,
      JSON.stringify(params.env || {}),
      params.url || null,
      params.enabled ? 1 : 0,
      params.auto_start ? 1 : 0,
      params.status || 'disconnected'
    ]
  )
  debounceSave()
  return getServerFromDB(id)!
}

function updateServerInDB(id: string, updates: Partial<McpServerConfig>): void {
  const allowed: Record<string, string> = {
    name: 'name',
    description: 'description',
    icon: 'icon',
    transport: 'transport',
    command: 'command',
    args: 'args',
    cwd: 'cwd',
    env: 'env',
    url: 'url',
    enabled: 'enabled',
    auto_start: 'auto_start'
  }
  const setClauses: string[] = []
  const values: any[] = []
  for (const [key, value] of Object.entries(updates)) {
    const dbKey = allowed[key]
    if (!dbKey) continue
    setClauses.push(`${dbKey} = ?`)
    if (dbKey === 'args' || dbKey === 'env') {
      values.push(JSON.stringify(value || (dbKey === 'args' ? [] : {})))
    } else if (dbKey === 'enabled' || dbKey === 'auto_start') {
      values.push(value ? 1 : 0)
    } else {
      values.push(value)
    }
  }
  if (setClauses.length === 0) return
  setClauses.push(`updated_at = datetime('now')`)
  values.push(id)

  const db = getDatabase()
  db.run(`UPDATE mcp_servers SET ${setClauses.join(', ')} WHERE id = ?`, values)
  debounceSave()
}

function deleteServerFromDB(id: string): void {
  const db = getDatabase()
  db.run('DELETE FROM mcp_servers WHERE id = ?', [id])
  debounceSave()
}

export function registerMcpIPC(): void {
  // 列出所有 MCP 服务器
  ipcMain.handle('mcp:list', async () => {
    return listServersFromDB()
  })

  // 获取单个服务器
  ipcMain.handle('mcp:get', async (_event, id: string) => {
    return getServerFromDB(id)
  })

  // 创建服务器
  ipcMain.handle(
    'mcp:create',
    async (_event, params: McpServerConfig & { autoConnect?: boolean }) => {
      try {
        const { autoConnect, ...config } = params
        const row = insertServer(config)
        if (autoConnect && config.enabled) {
          try {
            await mcpManager.connect(row.id)
          } catch (err: any) {
            // 连接失败不阻塞创建，只记录错误
            console.warn(`[MCP] Auto-connect failed for "${row.name}":`, err.message)
          }
        }
        return { success: true, server: getServerFromDB(row.id) }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // 更新服务器（如果当前已连接，更新后自动重连）
  ipcMain.handle(
    'mcp:update',
    async (_event, id: string, updates: Partial<McpServerConfig> & { reconnect?: boolean }) => {
      try {
        const { reconnect = true, ...configUpdates } = updates
        updateServerInDB(id, configUpdates)
        if (reconnect && mcpManager.isConnected(id)) {
          try {
            await mcpManager.reconnect(id)
          } catch (err: any) {
            console.warn(`[MCP] Reconnect after update failed:`, err.message)
          }
        }
        return { success: true, server: getServerFromDB(id) }
      } catch (err: any) {
        return { success: false, error: err.message }
      }
    }
  )

  // 删除服务器（先断开连接）
  ipcMain.handle('mcp:delete', async (_event, id: string) => {
    try {
      if (mcpManager.isConnected(id)) {
        await mcpManager.disconnect(id)
      }
      deleteServerFromDB(id)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 临时连接测试（不持久化）
  ipcMain.handle('mcp:testConnection', async (_event, config: McpServerConfig) => {
    return await mcpManager.testConnection(config)
  })

  // 手动连接
  ipcMain.handle('mcp:connect', async (_event, id: string) => {
    try {
      const result = await mcpManager.connect(id)
      return { success: true, toolCount: result.toolCount }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 手动断开
  ipcMain.handle('mcp:disconnect', async (_event, id: string) => {
    try {
      await mcpManager.disconnect(id)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 列出某服务器暴露的工具
  ipcMain.handle('mcp:listTools', async (_event, id: string) => {
    return mcpManager.listTools(id)
  })

  // 列出所有可用模板
  ipcMain.handle('mcp:listTemplates', async (): Promise<McpTemplate[]> => {
    return MCP_TEMPLATES
  })

  // 检测 Python 路径
  ipcMain.handle('mcp:detectPython', async (): Promise<{ path: string | null }> => {
    const path = await detectPythonPath()
    return { path }
  })

  // 检测 CATIA 服务器路径
  ipcMain.handle('mcp:detectCatiaServer', async (): Promise<{ path: string | null; valid: boolean }> => {
    const catiaPath = await detectCatiaServerPath()
    if (!catiaPath) return { path: null, valid: false }
    const valid = await validateCatiaServerPath(catiaPath)
    return { path: catiaPath, valid }
  })

  // 检测 Abaqus 服务器路径
  ipcMain.handle('mcp:detectAbaqusServer', async (): Promise<{ path: string | null; valid: boolean }> => {
    const abaqusPath = await detectAbaqusServerPath()
    if (!abaqusPath) return { path: null, valid: false }
    const valid = await validateAbaqusServerPath(abaqusPath)
    return { path: abaqusPath, valid }
  })
}
