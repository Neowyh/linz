import { getDatabase, debounceSave } from '../database'
import { v4 as uuidv4 } from 'uuid'
import { agentRegistry } from './agent-registry'
import { DynamicAgent, CustomAgentRow, safeParseArray } from './dynamic.agent'
import type { AgentOverrideConfig } from './base.agent'
import { reregisterBuiltinAgents } from './reregister'

// 内置 Agent id 集合（导出/导入校验、委派目标有效性判断复用）
export const BUILTIN_AGENT_IDS = ['orchestrator', 'general', 'aero', 'structural', 'propulsion', 'avionics', 'simulation', 'documentation', 'retriever', 'codereviewer']

// 引擎枚举：非 'pi' 一律归一为 'deepseek'（与 createCustomAgent 的默认语义一致），
// 防止脏数据/旧导入把任意字符串写进 engine 列、运行时静默落到 DeepSeek
function normalizeEngine(v: unknown): 'deepseek' | 'pi' {
  return v === 'pi' ? 'pi' : 'deepseek'
}

// 将 IPC 更新值转换为 sql.js 支持的绑定值；undefined/null 表示 SQL NULL。
function normalizeBindValue(value: any): any {
  if (value === undefined || value === null) return null
  return typeof value === 'object' ? JSON.stringify(value) : value
}

// 关键词缓存：keyword -> agentId
let customKeywordCache: Record<string, string> = {}
// 子任务前缀缓存：agentId -> prefix
let customPrefixCache: Record<string, string> = {}

export function getCustomKeywords(): Record<string, string> {
  return customKeywordCache
}

export function getCustomSubtaskPrefix(agentType: string): string | null {
  // 用 ?? 而非 ||：空串是合法的"不加前缀"显式设置，不应被当 falsy 当成"未设置"
  return customPrefixCache[agentType] ?? null
}

export function refreshCustomKeywordCache(): void {
  const db = getDatabase()
  const newKeywordCache: Record<string, string> = {}
  const newPrefixCache: Record<string, string> = {}
  const results = db.exec('SELECT id, keywords, subtask_prefix FROM custom_agents')
  if (!results[0]) {
    customKeywordCache = newKeywordCache
    customPrefixCache = newPrefixCache
    return
  }
  for (const row of results[0].values) {
    try {
      const agentId = row[0] as string
      const keywords = JSON.parse((row[1] as string) || '[]')
      const prefix = row[2] as string | null
      for (const kw of keywords) {
        newKeywordCache[kw] = agentId
      }
      if (prefix) {
        newPrefixCache[agentId] = prefix
      }
    } catch (err) {
      console.warn('[CustomAgents] Skipping malformed agent keywords:', err)
    }
  }
  customKeywordCache = newKeywordCache
  customPrefixCache = newPrefixCache
}

// Explicit column list to avoid issues with ALTER TABLE column ordering
const AGENT_COLUMNS = 'id, name, description, color, icon, system_prompt, tools, keywords, subtask_prefix, model_name, is_custom, usage_count, created_at, updated_at, delegates_to, engine, kb_tags'

function rowToCustomAgent(row: any[]): CustomAgentRow {
  return {
    id: row[0], name: row[1], description: row[2], color: row[3],
    icon: row[4], system_prompt: row[5], tools: row[6], keywords: row[7],
    subtask_prefix: row[8], model_name: row[9], is_custom: row[10],
    usage_count: row[11], created_at: row[12], updated_at: row[13],
    delegates_to: row[14] || '[]',
    engine: normalizeEngine(row[15]),
    kb_tags: row[16] || '[]'
  }
}

export function registerCustomAgentsFromDB(): void {
  try {
    const db = getDatabase()
    const results = db.exec(`SELECT ${AGENT_COLUMNS} FROM custom_agents WHERE is_custom = 1`)
    if (!results[0]) return
    let registered = 0
    for (const row of results[0].values) {
      try {
        const agentRow = rowToCustomAgent(row)
        const agent = new DynamicAgent(agentRow)
        agentRegistry.register(agent)
        registered++
      } catch (err) {
        // 单条坏数据不应中断整批自定义 Agent 注册：跳过并告警，其余继续
        console.warn('[CustomAgents] Skipping malformed custom agent row:', row[0], err)
        continue
      }
    }
    refreshCustomKeywordCache()
    console.log(`[CustomAgents] Registered ${registered} custom agents`)
  } catch (err) {
    console.warn('[CustomAgents] Failed to register custom agents:', err)
  }
}

// 注册“无专门 Agent 类的内置 agent”（如 codereviewer）：配置全在 DB seed，
// 用 DynamicAgent 包装。有别于 registerCustomAgentsFromDB（只读 is_custom=1）。
// 跳过已在 registry 的（前 9 个有专门类的内置 agent 在 registerAllAgents 硬编码注册）。
export function registerBuiltinDynamicAgents(): void {
  try {
    const db = getDatabase()
    const results = db.exec(`SELECT ${AGENT_COLUMNS} FROM custom_agents WHERE is_custom = 0`)
    if (!results[0]) return
    let registered = 0
    for (const row of results[0].values) {
      try {
        const agentRow = rowToCustomAgent(row)
        if (agentRegistry.get(agentRow.id)) continue // 已注册（有专门类的内置 agent）
        const agent = new DynamicAgent(agentRow)
        agentRegistry.register(agent)
        registered++
      } catch (err) {
        console.warn('[CustomAgents] Skipping malformed builtin agent row:', row[0], err)
        continue
      }
    }
    refreshCustomKeywordCache()
    if (registered > 0) console.log(`[CustomAgents] Registered ${registered} builtin dynamic agents`)
  } catch (err) {
    console.warn('[CustomAgents] Failed to register builtin dynamic agents:', err)
  }
}

export function registerSingleCustomAgent(row: CustomAgentRow): void {
  const agent = new DynamicAgent(row)
  agentRegistry.register(agent)
  refreshCustomKeywordCache()
}

export function unregisterCustomAgent(id: string): void {
  agentRegistry.unregister(id)
  refreshCustomKeywordCache()
}

export function getCustomAgentList(): CustomAgentRow[] {
  const db = getDatabase()
  const results = db.exec(`SELECT ${AGENT_COLUMNS} FROM custom_agents WHERE is_custom = 1 ORDER BY created_at DESC`)
  if (!results[0]) return []
  return results[0].values.map(rowToCustomAgent)
}

export function getCustomAgent(id: string): CustomAgentRow | null {
  const db = getDatabase()
  const results = db.exec(`SELECT ${AGENT_COLUMNS} FROM custom_agents WHERE id = ?`, [id])
  if (!results[0] || !results[0].values[0]) return null
  return rowToCustomAgent(results[0].values[0])
}

// 检查 name 是否已被其他 agent（内置或自定义）占用（大小写不敏感、去首尾空白）
// excludeId 用于更新场景，跳过自身
export function isAgentNameTaken(name: string, excludeId?: string): boolean {
  const target = name.trim().toLowerCase()
  if (!target) return false
  const db = getDatabase()
  const results = db.exec(`SELECT id, name FROM custom_agents`)
  if (!results[0]) return false
  for (const row of results[0].values) {
    const rowId = row[0] as string
    if (excludeId && rowId === excludeId) continue
    const rowName = (row[1] as string || '').trim().toLowerCase()
    if (rowName === target) return true
  }
  return false
}

export function createCustomAgent(params: {
  name: string; description?: string; color: string; icon: string;
  systemPrompt: string; tools: string[]; keywords: string[];
  subtaskPrefix?: string; modelName?: string; engine?: 'deepseek' | 'pi';
  kbTags?: string[]
}): CustomAgentRow {
  if (isAgentNameTaken(params.name)) {
    throw new Error(`Agent 名称 "${params.name}" 已存在，请使用其他名称`)
  }
  const db = getDatabase()
  const id = `agent-custom-${uuidv4()}`
  const toolsJson = JSON.stringify(params.tools)
  const keywordsJson = JSON.stringify(params.keywords)
  const engine = normalizeEngine(params.engine)
  const kbTagsJson = JSON.stringify(Array.isArray(params.kbTags) ? params.kbTags : [])

  db.run(
    `INSERT INTO custom_agents (id, name, description, color, icon, system_prompt, tools, keywords, subtask_prefix, model_name, engine, kb_tags) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, params.name, params.description || null, params.color, params.icon, params.systemPrompt, toolsJson, keywordsJson, params.subtaskPrefix || null, params.modelName || 'deepseek-chat', engine, kbTagsJson]
  )
  debounceSave()

  const row = getCustomAgent(id)!
  registerSingleCustomAgent(row)
  return row
}

export function updateCustomAgent(id: string, updates: Record<string, any>): { success: boolean; error?: string } {
  const existing = getCustomAgent(id)
  if (!existing) return { success: false, error: 'Agent 不存在' }

  // 若更新 name，检查冲突（含内置 agent 名称）
  const newName = typeof updates.name === 'string' ? updates.name : undefined
  if (newName && newName.trim() && isAgentNameTaken(newName, id)) {
    return { success: false, error: `Agent 名称 "${newName}" 已存在，请使用其他名称` }
  }

  const allowedFields = ['name', 'description', 'color', 'icon', 'system_prompt', 'tools', 'keywords', 'subtask_prefix', 'model_name', 'delegates_to', 'engine', 'kb_tags']
  const setClauses: string[] = []
  const values: any[] = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key === 'systemPrompt' ? 'system_prompt' : key === 'subtaskPrefix' ? 'subtask_prefix' : key === 'modelName' ? 'model_name' : key === 'kbTags' ? 'kb_tags' : key
    if (!allowedFields.includes(dbKey)) continue
    setClauses.push(`${dbKey} = ?`)
    values.push(normalizeBindValue(dbKey === 'engine' ? normalizeEngine(value) : value))
  }

  if (setClauses.length === 0) return { success: true }

  setClauses.push('updated_at = datetime("now")')
  values.push(id)

  const db = getDatabase()
  db.run(`UPDATE custom_agents SET ${setClauses.join(', ')} WHERE id = ?`, values)
  debounceSave()

  // 热重新注册
  agentRegistry.unregister(id)
  const updatedRow = getCustomAgent(id)!
  registerSingleCustomAgent(updatedRow)
  return { success: true }
}

export function deleteCustomAgent(id: string): { success: boolean; error?: string } {
  const existing = getCustomAgent(id)
  if (!existing) return { success: false, error: 'Agent 不存在' }

  const db = getDatabase()
  db.run('DELETE FROM custom_agents WHERE id = ?', [id])
  debounceSave()

  unregisterCustomAgent(id)
  return { success: true }
}

// Get keyword overrides for built-in agents from DB
export function getBuiltinAgentKeywords(): Record<string, string> {
  const db = getDatabase()
  const results = db.exec('SELECT id, keywords FROM custom_agents WHERE is_custom = 0')
  if (!results[0]) return {}

  const keywordMap: Record<string, string> = {}
  for (const row of results[0].values) {
    const agentId = row[0] as string
    const keywordsJson = row[1] as string
    if (!keywordsJson) continue
    try {
      const keywords: string[] = JSON.parse(keywordsJson)
      for (const kw of keywords) {
        keywordMap[kw] = agentId
      }
    } catch {
      // skip invalid JSON
    }
  }
  return keywordMap
}

// Get subtask prefix for a built-in agent from DB
export function getBuiltinSubtaskPrefix(agentType: string): string | undefined {
  const db = getDatabase()
  const results = db.exec('SELECT subtask_prefix FROM custom_agents WHERE id = ? AND is_custom = 0', [agentType])
  if (!results[0] || !results[0].values[0]) return undefined
  const prefix = results[0].values[0][0] as string | null
  if (prefix === null) return undefined
  return prefix
}

// Get full override config for all built-in agents
export function getBuiltinAgentOverrides(): Record<string, AgentOverrideConfig> {
  const db = getDatabase()
  const results = db.exec('SELECT id, name, color, icon, system_prompt, tools, keywords, delegates_to, subtask_prefix, model_name, engine FROM custom_agents WHERE is_custom = 0')
  if (!results[0]) return {}

  const overrides: Record<string, AgentOverrideConfig> = {}
  for (const row of results[0].values) {
    const id = row[0] as string
    const override: AgentOverrideConfig = {}
    if (row[1]) override.name = row[1] as string
    if (row[2]) override.color = row[2] as string
    if (row[3]) override.icon = row[3] as string
    if (row[4]) override.systemPrompt = row[4] as string
    if (row[5]) { try { override.toolNames = JSON.parse(row[5] as string) } catch {} }
    if (row[6]) { try { override.keywords = JSON.parse(row[6] as string) } catch {} }
    if (row[7]) { try { override.delegatesTo = JSON.parse(row[7] as string) } catch {} }
    if (row[8]) override.subtaskPrefix = row[8] as string
    if (row[9]) override.modelName = row[9] as string
    if (row[10]) override.engine = row[10] as 'deepseek' | 'pi'
    overrides[id] = override
  }
  return overrides
}

// Built-in agent CRUD
export function getBuiltinAgentList(): any[] {
  const db = getDatabase()
  const results = db.exec('SELECT id, name, description, color, icon, system_prompt, tools, keywords, delegates_to, subtask_prefix, model_name, is_custom, usage_count, created_at, updated_at, engine, kb_tags FROM custom_agents WHERE is_custom = 0 ORDER BY id')
  if (!results[0]) return []
  return results[0].values.map(row => ({
    id: row[0], name: row[1], description: row[2], color: row[3],
    icon: row[4], system_prompt: row[5], tools: row[6], keywords: row[7],
    delegates_to: row[8] ?? '[]', subtask_prefix: row[9], model_name: row[10],
    is_custom: row[11], usage_count: row[12], created_at: row[13], updated_at: row[14],
    engine: row[15] || 'deepseek', kb_tags: row[16] || '[]'
  }))
}

export function getBuiltinAgent(id: string): any | null {
  const db = getDatabase()
  const results = db.exec('SELECT id, name, description, color, icon, system_prompt, tools, keywords, delegates_to, subtask_prefix, model_name, is_custom, usage_count, created_at, updated_at, engine, kb_tags FROM custom_agents WHERE id = ? AND is_custom = 0', [id])
  if (!results[0] || !results[0].values[0]) return null
  const row = results[0].values[0]
  return {
    id: row[0], name: row[1], description: row[2], color: row[3],
    icon: row[4], system_prompt: row[5], tools: row[6], keywords: row[7],
    delegates_to: row[8] ?? '[]', subtask_prefix: row[9], model_name: row[10],
    is_custom: row[11], usage_count: row[12], created_at: row[13], updated_at: row[14],
    engine: row[15] || 'deepseek', kb_tags: row[16] || '[]'
  }
}

export function updateBuiltinAgent(id: string, updates: Record<string, any>): { success: boolean; error?: string } {
  if (!BUILTIN_AGENT_IDS.includes(id)) {
    return { success: false, error: '不是内置 Agent' }
  }

  // 若更新 name，检查与其他 agent（内置或自定义）的冲突
  const newName = typeof updates.name === 'string' ? updates.name : undefined
  if (newName && newName.trim() && isAgentNameTaken(newName, id)) {
    return { success: false, error: `Agent 名称 "${newName}" 已存在，请使用其他名称` }
  }

  const allowedFields = ['name','description','color','icon','system_prompt','tools','keywords','delegates_to','subtask_prefix','model_name','engine','kb_tags']
  const setClauses: string[] = []
  const values: any[] = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key === 'kbTags' ? 'kb_tags' : key
    if (!allowedFields.includes(dbKey)) continue
    setClauses.push(`${dbKey} = ?`)
    values.push(normalizeBindValue(dbKey === 'engine' ? normalizeEngine(value) : value))
  }

  if (setClauses.length === 0) return { success: true }

  setClauses.push('updated_at = datetime("now")')
  values.push(id)

  const db = getDatabase()
  db.run(`UPDATE custom_agents SET ${setClauses.join(', ')} WHERE id = ? AND is_custom = 0`, values)
  debounceSave()

  // Hot re-register built-in agents
  try {
    reregisterBuiltinAgents()
  } catch (err) {
    console.warn('[CustomAgents] Failed to re-register built-in agents:', err)
  }

  return { success: true }
}

export function resetBuiltinAgent(id: string, seedFn: (db: any, id: string) => void): { success: boolean; error?: string } {
  if (!BUILTIN_AGENT_IDS.includes(id)) {
    return { success: false, error: '不是内置 Agent' }
  }

  const db = getDatabase()
  db.run('DELETE FROM custom_agents WHERE id = ? AND is_custom = 0', [id])
  debounceSave()

  // Re-seed this specific agent
  seedFn(db, id)
  debounceSave()

  // Hot re-register built-in agents
  try {
    reregisterBuiltinAgents()
  } catch (err) {
    console.warn('[CustomAgents] Failed to re-register built-in agents:', err)
  }

  return { success: true }
}

// ============ 导出 / 导入（自定义 Agent 跨机器迁移） ============

// 导入候选：parse 后交给 UI 预览确认
export interface AgentImportCandidate {
  name: string
  description: string | null
  color: string
  icon: string
  system_prompt: string
  tools: string[]
  keywords: string[]
  delegates_to: string[]
  subtask_prefix: string | null
  model_name: string
  engine: string
  kb_tags: string[]
  duplicate: boolean       // 与本库现有 Agent 重名（确认导入时会自动加后缀）
  warnings: string[]       // MCP marker / 委派目标等跨机器提示
  sourceLabel: string      // 来源文件名，用于 UI 展示
}

// 导出文件名净化（与 export.ipc.ts 同款正则）
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_')
}

// MCP server marker 工具前缀（与渲染端 types/customAgent.ts 同款，主进程独立判断避免跨端依赖）
const MCP_SERVER_MARKER_PREFIX = 'mcp_server:'
function isMcpServerMarker(name: string): boolean {
  return typeof name === 'string' && name.startsWith(MCP_SERVER_MARKER_PREFIX)
}

// 把自定义 Agent 序列化为可分享的 JSON 字符串（不碰磁盘，写盘由 IPC 层负责）
export function exportCustomAgentToJSON(id: string): { content: string; fileName: string } | null {
  const row = getCustomAgent(id)
  if (!row) return null
  if (!row.is_custom) {
    throw new Error('内置 Agent 不支持导出')
  }
  const payload = {
    $schema: 'linz-agent-v1',
    exportedAt: new Date().toISOString(),
    agent: {
      name: row.name,
      description: row.description || '',
      color: row.color,
      icon: row.icon,
      system_prompt: row.system_prompt,
      tools: safeParseArray(row.tools),
      keywords: safeParseArray(row.keywords),
      delegates_to: safeParseArray(row.delegates_to),
      subtask_prefix: row.subtask_prefix,
      model_name: row.model_name || 'deepseek-chat',
      engine: row.engine || 'deepseek',
      kb_tags: safeParseArray(row.kb_tags)
    }
  }
  const content = JSON.stringify(payload, null, 2)
  const fileName = `${sanitizeFileName(row.name)}.linz-agent.json`
  return { content, fileName }
}

// 解析导入文件内容 → 候选（含跨机器 warning、重名标记），不落库
export function parseAgentImportFile(raw: string, sourceLabel: string): { candidate: AgentImportCandidate | null; errors: string[] } {
  const errors: string[] = []
  let obj: any
  try {
    obj = JSON.parse(raw)
  } catch {
    return { candidate: null, errors: [`${sourceLabel}: JSON 解析失败，不是合法的 Agent 文件`] }
  }
  if (!obj || obj.$schema !== 'linz-agent-v1' || !obj.agent || typeof obj.agent !== 'object') {
    return { candidate: null, errors: [`${sourceLabel}: 不是临智 Agent 导出文件（$schema 不匹配）`] }
  }
  const a = obj.agent
  // 必填字段校验
  if (!a.name || typeof a.name !== 'string' || !a.name.trim()) errors.push(`${sourceLabel}: 缺少 name`)
  if (!a.system_prompt || typeof a.system_prompt !== 'string' || !a.system_prompt.trim()) errors.push(`${sourceLabel}: 缺少 system_prompt`)
  if (!a.color) errors.push(`${sourceLabel}: 缺少 color`)
  if (!a.icon) errors.push(`${sourceLabel}: 缺少 icon`)
  if (errors.length > 0) return { candidate: null, errors }

  const tools: string[] = Array.isArray(a.tools) ? a.tools.filter((t: any) => typeof t === 'string') : []
  const keywords: string[] = Array.isArray(a.keywords) ? a.keywords.filter((t: any) => typeof t === 'string') : []
  const delegatesTo: string[] = Array.isArray(a.delegates_to) ? a.delegates_to.filter((t: any) => typeof t === 'string') : []
  const kbTags: string[] = Array.isArray(a.kb_tags) ? a.kb_tags.filter((t: any) => typeof t === 'string') : []

  const warnings: string[] = []
  // MCP server marker：目标机器需配同名 MCP 服务器
  const mcpMarkers = tools.filter(isMcpServerMarker)
  if (mcpMarkers.length > 0) {
    warnings.push(`工具含 MCP 服务器挂载标记（${mcpMarkers.join(', ')}），目标机器需配置同名 MCP 服务器，否则该工具不生效`)
  }
  // 委派目标非内置 id：目标机器可能不存在该自定义 agent
  const externalDelegates = delegatesTo.filter((t) => !BUILTIN_AGENT_IDS.includes(t))
  if (externalDelegates.length > 0) {
    warnings.push(`委派目标 ${externalDelegates.join(', ')} 在目标机器可能不存在，导入后需在编辑器里重新配置委派关系`)
  }

  const name = a.name.trim()
  const candidate: AgentImportCandidate = {
    name,
    description: a.description ?? null,
    color: a.color,
    icon: a.icon,
    system_prompt: a.system_prompt,
    tools,
    keywords,
    delegates_to: delegatesTo,
    subtask_prefix: a.subtask_prefix ?? null,
    model_name: a.model_name || 'deepseek-chat',
    engine: a.engine === 'pi' ? 'pi' : 'deepseek',
    kb_tags: kbTags,
    duplicate: isAgentNameTaken(name),
    warnings,
    sourceLabel
  }
  return { candidate, errors }
}

// 确认导入：重名自动加 " (n)" 后缀，复用 createCustomAgent 落库+热注册
export function confirmAgentImport(item: AgentImportCandidate): { success: boolean; agent?: CustomAgentRow; error?: string } {
  let name = item.name.trim()
  if (isAgentNameTaken(name)) {
    let n = 2
    while (isAgentNameTaken(`${name} (${n})`)) n++
    name = `${name} (${n})`
  }
  try {
    const row = createCustomAgent({
      name,
      description: item.description || undefined,
      color: item.color,
      icon: item.icon,
      systemPrompt: item.system_prompt,
      tools: item.tools,
      keywords: item.keywords,
      subtaskPrefix: item.subtask_prefix || undefined,
      modelName: item.model_name,
      engine: item.engine === 'pi' ? 'pi' : 'deepseek',
      kbTags: item.kb_tags
    })
    return { success: true, agent: row }
  } catch (err: any) {
    return { success: false, error: err?.message || String(err) }
  }
}
