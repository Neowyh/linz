import { ipcMain, BrowserWindow } from 'electron'
import {
  listAllSkills,
  getSkill,
  createSkill,
  updateSkill,
  deleteSkill,
  toggleSkill,
  type CreateSkillParams,
  type UpdateSkillParams
} from '../agents/agent-skills.service'
import type { AgentSkill } from '../database'

function parseJsonArray(str: string): string[] {
  try {
    const arr = JSON.parse(str || '[]')
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}

// 把 DB 行（JSON 字符串字段）转换为渲染端期望的数组形式
function toClientSkill(skill: AgentSkill): {
  id: string
  name: string
  description: string | null
  content: string
  target_agents: string[]
  trigger_keywords: string[]
  priority: number
  enabled: boolean
  is_builtin: boolean
  is_custom: boolean
  created_at: string
  updated_at: string
} {
  return {
    id: skill.id,
    name: skill.name,
    description: skill.description,
    content: skill.content,
    target_agents: parseJsonArray(skill.target_agents),
    trigger_keywords: parseJsonArray(skill.trigger_keywords),
    priority: skill.priority,
    enabled: skill.enabled === 1,
    is_builtin: skill.is_builtin === 1,
    is_custom: skill.is_custom === 1,
    created_at: skill.created_at,
    updated_at: skill.updated_at
  }
}

export function registerAgentSkillsIPC(_mainWindow: BrowserWindow): void {
  ipcMain.handle('agent-skill:list', async () => {
    return listAllSkills().map(toClientSkill)
  })

  ipcMain.handle('agent-skill:get', async (_event, id: string) => {
    const skill = getSkill(id)
    return skill ? toClientSkill(skill) : null
  })

  ipcMain.handle('agent-skill:create', async (_event, params: CreateSkillParams) => {
    try {
      const skill = createSkill(params)
      return { success: true, skill: toClientSkill(skill) }
    } catch (err: any) {
      return { success: false, error: err?.message || String(err) }
    }
  })

  ipcMain.handle('agent-skill:update', async (_event, id: string, updates: UpdateSkillParams) => {
    const result = updateSkill(id, updates)
    if (result.success && result.skill) {
      return { success: true, skill: toClientSkill(result.skill) }
    }
    return { success: false, error: result.error }
  })

  ipcMain.handle('agent-skill:delete', async (_event, id: string) => {
    const result = deleteSkill(id)
    return result
  })

  ipcMain.handle('agent-skill:toggle', async (_event, id: string, enabled: boolean) => {
    const result = toggleSkill(id, enabled)
    return result
  })
}
