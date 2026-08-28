import { getDatabase, debounceSave, type AgentSkill } from '../database'
import { v4 as uuidv4 } from 'uuid'
import fs from 'fs'
import path from 'path'

// 显式列名，避免 ALTER TABLE 列顺序问题
const SKILL_COLUMNS = 'id, name, description, content, target_agents, trigger_keywords, priority, enabled, is_builtin, is_custom, created_at, updated_at, package_path'

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
    updated_at: row[11],
    package_path: row[12] ?? null
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

// 技能触发信息：用于流式链路发射"技能已触发"UI 提示（与工具调用卡片同层展示）
export interface SkillTriggerInfo {
  skillId: string
  skillName: string
  source: 'forced' | 'matched'  // forced=用户在对话中 "/" 主动注入；matched=关键词自动匹配
}

// 计算某个 Agent + 任务实际生效的技能（强制注入优先 + 关键词匹配），返回技能列表与触发信息。
// getEffectiveSystemPrompt 用它拼 prompt；流式链路用它发射 skillTriggers chunk 给渲染端展示。
export function resolveEffectiveSkills(
  agentType: string,
  task: string | undefined,
  forcedSkillIds?: string[]
): { skills: AgentSkill[]; triggers: SkillTriggerInfo[] } {
  const forced = forcedSkillIds?.length ? getSkillsByIds(forcedSkillIds) : []
  const matched = getEffectiveSkillsForAgent(agentType, task || '')
  const forcedIds = new Set(forced.map((s) => s.id))
  const skills = [...forced, ...matched.filter((s) => !forcedIds.has(s.id))]
  const triggers: SkillTriggerInfo[] = [
    ...forced.map((s) => ({ skillId: s.id, skillName: s.name, source: 'forced' as const })),
    ...matched.filter((s) => !forcedIds.has(s.id)).map((s) => ({ skillId: s.id, skillName: s.name, source: 'matched' as const }))
  ]
  return { skills, triggers }
}

// 列出技能包 scripts/ 下的脚本文件（相对路径，如 scripts/run.py）
export function listSkillScripts(packagePath: string): string[] {
  try {
    const scriptDir = path.join(packagePath, 'scripts')
    if (!fs.statSync(scriptDir).isDirectory()) return []
    const out: string[] = []
    const walk = (dir: string, prefix: string): void => {
      for (const f of fs.readdirSync(dir).sort()) {
        const full = path.join(dir, f)
        if (fs.statSync(full).isDirectory()) walk(full, `${prefix}${f}/`)
        else if (!f.startsWith('.')) out.push(`${prefix}${f}`)
      }
    }
    walk(scriptDir, 'scripts/')
    return out
  } catch {
    return []
  }
}

// 把技能列表格式化为系统提示词片段
export function formatSkillsForPrompt(skills: AgentSkill[]): string {
  if (skills.length === 0) return ''
  const blocks = skills.map((s) => {
    const desc = s.description ? `${s.description}\n\n` : ''
    let block = `### ${s.name}\n${desc}${s.content}`
    // 技能包含可执行脚本时，告知 Agent 脚本位置与执行工具
    if (s.package_path) {
      const scripts = listSkillScripts(s.package_path)
      if (scripts.length > 0) {
        block += `\n\n> 本技能附带脚本（位于 ${s.package_path}），需要执行时使用 run_skill_script 工具：\n${scripts.map((f) => `> - ${f}`).join('\n')}`
      }
    }
    return block
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

// 按 ID 批量取启用中的技能（对话中 "/" 主动注入用；禁用技能不可注入）
export function getSkillsByIds(ids: string[]): AgentSkill[] {
  if (!ids || ids.length === 0) return []
  const db = getDatabase()
  const placeholders = ids.map(() => '?').join(', ')
  const results = db.exec(
    `SELECT ${SKILL_COLUMNS} FROM agent_skills WHERE enabled = 1 AND id IN (${placeholders})`,
    ids
  )
  if (!results[0]) return []
  return results[0].values.map(rowToAgentSkill)
}

function isSkillNameTaken(name: string, excludeId?: string): boolean {
  const db = getDatabase()
  const results = excludeId
    ? db.exec('SELECT id FROM agent_skills WHERE LOWER(TRIM(name)) = LOWER(?) AND id != ?', [name.trim(), excludeId])
    : db.exec('SELECT id FROM agent_skills WHERE LOWER(TRIM(name)) = LOWER(?)', [name.trim()])
  return Boolean(results[0] && results[0].values.length > 0)
}

// 按 ID 或名称（大小写不敏感）查找启用中的技能，run_skill_script 工具用
export function findSkillByNameOrId(nameOrId: string): AgentSkill | null {
  const db = getDatabase()
  const results = db.exec(
    `SELECT ${SKILL_COLUMNS} FROM agent_skills WHERE enabled = 1 AND (id = ? OR LOWER(TRIM(name)) = LOWER(?))`,
    [nameOrId, nameOrId.trim()]
  )
  if (!results[0] || !results[0].values[0]) return null
  return rowToAgentSkill(results[0].values[0])
}

// 写入技能包落盘目录（导入时复制/解压完成后调用）
export function setSkillPackagePath(id: string, packagePath: string): void {
  const db = getDatabase()
  db.run('UPDATE agent_skills SET package_path = ?, updated_at = ? WHERE id = ?', [packagePath, new Date().toISOString(), id])
  debounceSave()
  refreshSkillCache()
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
  if (isSkillNameTaken(params.name)) {
    throw new Error(`已存在同名技能「${params.name.trim()}」，请换个名称`)
  }
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
  if (updates.name !== undefined && isSkillNameTaken(updates.name, id)) {
    return { success: false, error: `已存在同名技能「${updates.name.trim()}」，请换个名称` }
  }

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
  // 清理导入时落盘的技能包目录（scripts 等）
  if (existing.package_path) {
    try {
      fs.rmSync(existing.package_path, { recursive: true, force: true })
    } catch (err) {
      console.warn(`[AgentSkills] 清理技能包目录失败（${existing.package_path}）:`, err)
    }
  }
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
