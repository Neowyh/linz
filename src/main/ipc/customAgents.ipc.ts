import { ipcMain, BrowserWindow } from 'electron'
import {
  getCustomAgentList, getCustomAgent,
  createCustomAgent, updateCustomAgent, deleteCustomAgent,
  getBuiltinAgentList, getBuiltinAgent, updateBuiltinAgent, resetBuiltinAgent
} from '../agents/custom-agents.service'
import { AVAILABLE_TOOL_NAMES, getAvailableToolInfos } from '../agents/tools'

export function registerCustomAgentsIPC(_mainWindow: BrowserWindow): void {
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
}
