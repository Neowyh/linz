import { ipcMain, BrowserWindow, dialog } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import {
  getCustomAgentList, getCustomAgent,
  createCustomAgent, updateCustomAgent, deleteCustomAgent,
  getBuiltinAgentList, getBuiltinAgent, updateBuiltinAgent, resetBuiltinAgent,
  exportCustomAgentToJSON, parseAgentImportFile, confirmAgentImport,
  type AgentImportCandidate
} from '../agents/custom-agents.service'
import { AVAILABLE_TOOL_NAMES, getAvailableToolInfos } from '../agents/tools'

export function registerCustomAgentsIPC(mainWindow: BrowserWindow): void {
  // 列出所有自定义 Agent
  ipcMain.handle('agent:listCustom', async () => {
    return getCustomAgentList()
  })

  // 获取单个自定义 Agent
  ipcMain.handle('agent:getCustom', async (_event, id: string) => {
    return getCustomAgent(id)
  })

  // 创建自定义 Agent
  ipcMain.handle('agent:createCustom', async (_event, params: {
    name: string; description?: string; color: string; icon: string;
    systemPrompt: string; tools: string[]; keywords: string[];
    subtaskPrefix?: string; modelName?: string; engine?: 'deepseek' | 'pi';
    kbTags?: string[]
  }) => {
    try {
      const row = createCustomAgent(params)
      return { success: true, agent: row }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  })

  // 更新自定义 Agent
  ipcMain.handle('agent:updateCustom', async (_event, id: string, updates: Record<string, any>) => {
    return updateCustomAgent(id, updates)
  })

  // 删除自定义 Agent
  ipcMain.handle('agent:deleteCustom', async (_event, id: string) => {
    return deleteCustomAgent(id)
  })

  // 列出所有内置 Agent
  ipcMain.handle('agent:listBuiltin', async () => {
    return getBuiltinAgentList()
  })

  // 获取单个内置 Agent
  ipcMain.handle('agent:getBuiltin', async (_event, id: string) => {
    return getBuiltinAgent(id)
  })

  // 更新内置 Agent
  ipcMain.handle('agent:updateBuiltin', async (_event, id: string, updates: Record<string, any>) => {
    return updateBuiltinAgent(id, updates)
  })

  // 重置内置 Agent 为默认配置
  ipcMain.handle('agent:resetBuiltin', async (_event, id: string) => {
    const { seedSingleBuiltinAgent } = require('../database')
    return resetBuiltinAgent(id, (_db: any, agentId: string) => {
      if (seedSingleBuiltinAgent) {
        seedSingleBuiltinAgent(agentId)
      }
    })
  })

  // 获取可用工具列表（动态：内置 + MCP + 自定义，含 source/serverId/serverName 字段）
  ipcMain.handle('agent:availableTools', async () => {
    return getAvailableToolInfos()
  })

  // ============ 自定义 Agent 导出 / 导入 ============

  // 导出单个自定义 Agent 为 .linz-agent.json
  ipcMain.handle('agent:exportAgent', async (_event, id: string) => {
    let payload: { content: string; fileName: string }
    try {
      const result = exportCustomAgentToJSON(id)
      if (!result) return { success: false, error: 'Agent 不存在' }
      payload = result
    } catch (err: any) {
      return { success: false, error: err?.message || '导出失败' }
    }
    const dlg = await dialog.showSaveDialog(mainWindow, {
      title: '导出 Agent',
      defaultPath: payload.fileName,
      filters: [
        { name: '临智 Agent', extensions: ['linz-agent.json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (dlg.canceled || !dlg.filePath) return { success: false, canceled: true }
    try {
      fs.writeFileSync(dlg.filePath, payload.content, 'utf8')
      return { success: true, filePath: dlg.filePath }
    } catch (err: any) {
      return { success: false, error: err?.message || '写入文件失败' }
    }
  })

  // 选择导入文件（多选）
  ipcMain.handle('agent:importPick', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 Agent 文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '临智 Agent', extensions: ['linz-agent.json'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    return result.canceled ? [] : result.filePaths
  })

  // 解析选中的文件 → 候选列表（不落库）
  ipcMain.handle('agent:importParse', async (_event, paths: string[]) => {
    const candidates: AgentImportCandidate[] = []
    const errors: string[] = []
    for (const p of paths) {
      const label = path.basename(p)
      try {
        const raw = fs.readFileSync(p, 'utf8')
        const { candidate, errors: errs } = parseAgentImportFile(raw, label)
        if (errs.length > 0) errors.push(...errs)
        if (candidate) candidates.push(candidate)
      } catch (err: any) {
        errors.push(`${label}: ${err?.message || '读取失败'}`)
      }
    }
    return { candidates, errors }
  })

  // 确认导入（重名自动加后缀）
  ipcMain.handle('agent:importConfirm', async (_event, items: AgentImportCandidate[]) => {
    const names: string[] = []
    const errors: string[] = []
    for (const item of items) {
      const result = confirmAgentImport(item)
      if (result.success && result.agent) {
        names.push(result.agent.name)
      } else if (result.error) {
        errors.push(`${item.name}: ${result.error}`)
      }
    }
    return { success: errors.length === 0, imported: names.length, names, errors }
  })
}
