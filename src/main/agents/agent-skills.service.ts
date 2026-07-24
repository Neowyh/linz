import { getDatabase, debounceSave, type AgentSkill } from '../database'
import { v4 as uuidv4 } from 'uuid'

// 显式列名，避免 ALTER TABLE 列顺序问题
const SKILL_COLUMNS = 'id, name, description, content, target_agents, trigger_keywords, priority, enabled, is_builtin, is_custom, created_at, updated_at'

function rowToAgentSkill(row: any[]): AgentSkill {
  return {
    id: row[0],
    name: row[1],
    description: row[2],
    content: row[3],
    target_agents: row[4] || '[]',
    trigger_keywords: row[5] || '[]',
    priority: row[6] || 0,
    enabled: row[7],
    is_builtin: row[8],
    is_custom: row[9],
    created_at: row[10],
    updated_at: row[11]
  }
}

function parseJsonArray(str: string): string[] {
  try {
    const arr = JSON.parse(str || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// 模块级缓存：仅缓存 enabled=1 的技能（运行时只需要启用的）
// 写操作后通过 refreshSkillCache() 原子替换
let skillCache: AgentSkill[] = []

export function refreshSkillCache(): void {
  const db = getDatabase()
  const results = db.exec(`SELECT ${SKILL_COLUMNS} FROM agent_skills WHERE enabled = 1`)
  const newCache: AgentSkill[] = []
  if (results[0]) {
    for (const row of results[0].values) {
      try {
        newCache.push(rowToAgentSkill(row))
      } catch (err) {
        console.warn('[AgentSkills] Skipping malformed skill row:', err)
      }
    }
  }
  skillCache = newCache
}

// 返回当前 Agent 类型 + 任务匹配的技能列表
// 规则：
//   - target_agents 为空 → 适用所有 Agent；非空 → 必须包含 agentType
//   - trigger_keywords 为空 → 始终启用；非空 → 任务命中任一关键词才注入
//   - 按 priority DESC 排序，最多取 10 条避免 prompt 膨胀
export function getEffectiveSkillsForAgent(agentType: string, task: string): AgentSkill[] {
  const taskLower = (task || '').toLowerCase()
  const matched = skillCache.filter((skill) => {
    const targets = parseJsonArray(skill.target_agents)
    if (targets.length > 0 && !targets.includes(agentType)) return false

    const keywords = parseJsonArray(skill.trigger_keywords)
    if (keywords.length === 0) return true  // 始终启用

    return keywords.some((kw) => taskLower.includes(kw.toLowerCase()))
  })
  matched.sort((a, b) => b.priority - a.priority)
  return matched.slice(0, 10)
}

// 把技能列表格式化为系统提示词片段
export function formatSkillsForPrompt(skills: AgentSkill[]): string {
  if (skills.length === 0) return ''
  const blocks = skills.map((s) => {
    const desc = s.description ? `${s.description}\n\n` : ''
    return `### ${s.name}\n${desc}${s.content}`
  })
  return `## 可用技能\n\n以下技能与本任务相关，请在回答时参考其中的步骤和规范：\n\n${blocks.join('\n\n---\n\n')}`
}

// === CRUD ===

export function listAllSkills(): AgentSkill[] {
  const db = getDatabase()
  const results = db.exec(`SELECT ${SKILL_COLUMNS} FROM agent_skills ORDER BY is_builtin DESC, priority DESC, created_at DESC`)
  if (!results[0]) return []
  return results[0].values.map(rowToAgentSkill)
}

export function getSkill(id: string): AgentSkill | null {
  const db = getDatabase()
  const results = db.exec(`SELECT ${SKILL_COLUMNS} FROM agent_skills WHERE id = ?`, [id])
  if (!results[0] || !results[0].values[0]) return null
  return rowToAgentSkill(results[0].values[0])
}

export interface CreateSkillParams {
  name: string
  description?: string
  content: string
  targetAgents?: string[]
  triggerKeywords?: string[]
  priority?: number
  enabled?: boolean
}

export function createSkill(params: CreateSkillParams): AgentSkill {
  const db = getDatabase()
  const id = `agent-skill-custom-${uuidv4()}`
  const now = new Date().toISOString()
  db.run(
    `INSERT INTO agent_skills (id, name, description, content, target_agents, trigger_keywords, priority, enabled, is_builtin, is_custom, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?, ?)`,
    [
      id,
      params.name,
      params.description || null,
      params.content,
      JSON.stringify(params.targetAgents || []),
      JSON.stringify(params.triggerKeywords || []),
      params.priority ?? 0,
      params.enabled === false ? 0 : 1,
      now,
      now
    ]
  )
  debounceSave()
  refreshSkillCache()
  return getSkill(id)!
}

export interface UpdateSkillParams {
  name?: string
  description?: string
  content?: string
  targetAgents?: string[]
  triggerKeywords?: string[]
  priority?: number
  enabled?: boolean
}

export function updateSkill(id: string, updates: UpdateSkillParams): { success: boolean; error?: string; skill?: AgentSkill } {
  const db = getDatabase()
  const existing = getSkill(id)
  if (!existing) return { success: false, error: '技能不存在' }
  if (existing.is_builtin === 1) return { success: false, error: '内置技能不可修改' }

  const setClauses: string[] = []
  const values: any[] = []
  if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name) }
  if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description) }
  if (updates.content !== undefined) { setClauses.push('content = ?'); values.push(updates.content) }
  if (updates.targetAgents !== undefined) { setClauses.push('target_agents = ?'); values.push(JSON.stringify(updates.targetAgents)) }
  if (updates.triggerKeywords !== undefined) { setClauses.push('trigger_keywords = ?'); values.push(JSON.stringify(updates.triggerKeywords)) }
  if (updates.priority !== undefined) { setClauses.push('priority = ?'); values.push(updates.priority) }
  if (updates.enabled !== undefined) { setClauses.push('enabled = ?'); values.push(updates.enabled ? 1 : 0) }

  if (setClauses.length === 0) return { success: true, skill: existing }

  setClauses.push('updated_at = ?')
  values.push(new Date().toISOString())
  values.push(id)

  db.run(`UPDATE agent_skills SET ${setClauses.join(', ')} WHERE id = ?`, values)
  debounceSave()
  refreshSkillCache()
  return { success: true, skill: getSkill(id) ?? undefined }
}

export function deleteSkill(id: string): { success: boolean; error?: string } {
  const db = getDatabase()
  const existing = getSkill(id)
  if (!existing) return { success: false, error: '技能不存在' }
  if (existing.is_builtin === 1) return { success: false, error: '内置技能不可删除' }

  db.run('DELETE FROM agent_skills WHERE id = ?', [id])
  debounceSave()
  refreshSkillCache()
  return { success: true }
}

export function toggleSkill(id: string, enabled: boolean): { success: boolean; error?: string } {
  const db = getDatabase()
  const existing = getSkill(id)
  if (!existing) return { success: false, error: '技能不存在' }

  db.run('UPDATE agent_skills SET enabled = ?, updated_at = ? WHERE id = ?', [enabled ? 1 : 0, new Date().toISOString(), id])
  debounceSave()
  refreshSkillCache()
  return { success: true }
}
