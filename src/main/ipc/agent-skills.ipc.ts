import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
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
import {
  parseImportPaths,
  confirmImport,
  buildSkillMarkdown,
  type ConfirmImportItem
} from '../agents/skill-import.service'
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
  package_path: string | null
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
    updated_at: skill.updated_at,
    package_path: skill.package_path ?? null
  }
}

export function registerAgentSkillsIPC(mainWindow: BrowserWindow): void {  ipcMain.handle('agent-skill:list', async () => {
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

  // === 技能导入（SKILL.md / 文件夹 / zip 技能包） ===

  ipcMain.handle('agent-skill:importPick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择技能文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '技能文件', extensions: ['md', 'zip'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('agent-skill:importPickFolder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择技能文件夹（含 SKILL.md，或包含多个技能子目录）',
      properties: ['openDirectory']
    })
    return result.canceled ? [] : result.filePaths
  })

  ipcMain.handle('agent-skill:importParse', async (_event, paths: string[]) => {
    try {
      return parseImportPaths(paths)
    } catch (err: any) {
      return { candidates: [], errors: [err?.message || '解析失败'] }
    }
  })

  ipcMain.handle('agent-skill:importConfirm', async (_event, items: ConfirmImportItem[]) => {
    try {
      return { success: true, ...confirmImport(items) }
    } catch (err: any) {
      return { success: false, imported: 0, names: [], error: err?.message || String(err) }
    }
  })

  // 导出为标准 SKILL.md
  ipcMain.handle('agent-skill:export', async (_event, id: string) => {
    const skill = getSkill(id)
    if (!skill) return { success: false, error: '技能不存在' }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出技能为 SKILL.md',
      defaultPath: 'SKILL.md',
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    })
    if (result.canceled || !result.filePath) return { success: false, canceled: true }
    try {
      fs.writeFileSync(result.filePath, buildSkillMarkdown(skill), 'utf-8')
      return { success: true, filePath: result.filePath }
    } catch (err: any) {
      return { success: false, error: err?.message || '写入失败' }
    }
  })
}
