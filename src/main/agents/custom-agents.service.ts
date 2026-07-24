import { getDatabase, debounceSave } from '../database'
import { v4 as uuidv4 } from 'uuid'
import { agentRegistry } from './agent-registry'
import { DynamicAgent, CustomAgentRow } from './dynamic.agent'
import type { AgentOverrideConfig } from './base.agent'
import { reregisterBuiltinAgents } from './reregister'

// 关键词缓存：keyword -> agentId
let customKeywordCache: Record<string, string> = {}
// 子任务前缀缓存：agentId -> prefix
let customPrefixCache: Record<string, string> = {}

export function getCustomKeywords(): Record<string, string> {
  return customKeywordCache
}

export function getCustomSubtaskPrefix(agentType: string): string | null {
  return customPrefixCache[agentType] || null
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
const AGENT_COLUMNS = 'id, name, description, color, icon, system_prompt, tools, keywords, subtask_prefix, model_name, is_custom, usage_count, created_at, updated_at, delegates_to, engine'

function rowToCustomAgent(row: any[]): CustomAgentRow {
  return {
    id: row[0], name: row[1], description: row[2], color: row[3],
    icon: row[4], system_prompt: row[5], tools: row[6], keywords: row[7],
    subtask_prefix: row[8], model_name: row[9], is_custom: row[10],
    usage_count: row[11], created_at: row[12], updated_at: row[13],
    delegates_to: row[14] || '[]',
    engine: row[15] || 'deepseek'
  }
}

export function registerCustomAgentsFromDB(): void {
  try {
    const db = getDatabase()
    const results = db.exec(`SELECT ${AGENT_COLUMNS} FROM custom_agents WHERE is_custom = 1`)
    if (!results[0]) return
    for (const row of results[0].values) {
      const agentRow = rowToCustomAgent(row)
      const agent = new DynamicAgent(agentRow)
      agentRegistry.register(agent)
    }
    refreshCustomKeywordCache()
    console.log(`[CustomAgents] Registered ${results[0].values.length} custom agents`)
  } catch (err) {
    console.warn('[CustomAgents] Failed to register custom agents:', err)
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
  subtaskPrefix?: string; modelName?: string; engine?: 'deepseek' | 'pi'
}): CustomAgentRow {
  if (isAgentNameTaken(params.name)) {
    throw new Error(`Agent 名称 "${params.name}" 已存在，请使用其他名称`)
  }
  const db = getDatabase()
  const id = `agent-custom-${uuidv4()}`
  const toolsJson = JSON.stringify(params.tools)
  const keywordsJson = JSON.stringify(params.keywords)
  const engine = params.engine || 'deepseek'

  db.run(
    `INSERT INTO custom_agents (id, name, description, color, icon, system_prompt, tools, keywords, subtask_prefix, model_name, engine) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, params.name, params.description || null, params.color, params.icon, params.systemPrompt, toolsJson, keywordsJson, params.subtaskPrefix || null, params.modelName || 'deepseek-chat', engine]
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

  const allowedFields = ['name', 'description', 'color', 'icon', 'system_prompt', 'tools', 'keywords', 'subtask_prefix', 'model_name', 'delegates_to', 'engine']
  const setClauses: string[] = []
  const values: any[] = []

  for (const [key, value] of Object.entries(updates)) {
    const dbKey = key === 'systemPrompt' ? 'system_prompt' : key === 'subtaskPrefix' ? 'subtask_prefix' : key === 'modelName' ? 'model_name' : key
    if (!allowedFields.includes(dbKey)) continue
    setClauses.push(`${dbKey} = ?`)
    values.push(typeof value === 'object' ? JSON.stringify(value) : value)
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
  const results = db.exec('SELECT id, name, description, color, icon, system_prompt, tools, keywords, delegates_to, subtask_prefix, model_name, is_custom, usage_count, created_at, updated_at, engine FROM custom_agents WHERE is_custom = 0 ORDER BY id')
  if (!results[0]) return []
  return results[0].values.map(row => ({
    id: row[0], name: row[1], description: row[2], color: row[3],
    icon: row[4], system_prompt: row[5], tools: row[6], keywords: row[7],
    delegates_to: row[8] ?? '[]', subtask_prefix: row[9], model_name: row[10],
    is_custom: row[11], usage_count: row[12], created_at: row[13], updated_at: row[14],
    engine: row[15] || 'deepseek'
  }))
}

export function getBuiltinAgent(id: string): any | null {
  const db = getDatabase()
  const results = db.exec('SELECT id, name, description, color, icon, system_prompt, tools, keywords, delegates_to, subtask_prefix, model_name, is_custom, usage_count, created_at, updated_at, engine FROM custom_agents WHERE id = ? AND is_custom = 0', [id])
  if (!results[0] || !results[0].values[0]) return null
  const row = results[0].values[0]
  return {
    id: row[0], name: row[1], description: row[2], color: row[3],
    icon: row[4], system_prompt: row[5], tools: row[6], keywords: row[7],
    delegates_to: row[8] ?? '[]', subtask_prefix: row[9], model_name: row[10],
    is_custom: row[11], usage_count: row[12], created_at: row[13], updated_at: row[14],
    engine: row[15] || 'deepseek'
  }
}

export function updateBuiltinAgent(id: string, updates: Record<string, any>): { success: boolean; error?: string } {
  const validBuiltinIds = ['orchestrator','general','aero','structural','propulsion','avionics','simulation','documentation','retriever']
  if (!validBuiltinIds.includes(id)) {
    return { success: false, error: '不是内置 Agent' }
  }

  // 若更新 name，检查与其他 agent（内置或自定义）的冲突
  const newName = typeof updates.name === 'string' ? updates.name : undefined
  if (newName && newName.trim() && isAgentNameTaken(newName, id)) {
    return { success: false, error: `Agent 名称 "${newName}" 已存在，请使用其他名称` }
  }

  const allowedFields = ['name','description','color','icon','system_prompt','tools','keywords','delegates_to','subtask_prefix','model_name','engine']
  const setClauses: string[] = []
  const values: any[] = []

  for (const [key, value] of Object.entries(updates)) {
    if (!allowedFields.includes(key)) continue
    setClauses.push(`${key} = ?`)
    values.push(typeof value === 'object' ? JSON.stringify(value) : value)
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
  const validBuiltinIds = ['orchestrator','general','aero','structural','propulsion','avionics','simulation','documentation','retriever']
  if (!validBuiltinIds.includes(id)) {
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
