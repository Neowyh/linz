import { ipcMain, BrowserWindow } from 'electron'
import {
  listWorkspaces,
  getCurrentWorkspace,
  createWorkspace,
  deleteWorkspace,
  renameWorkspace,
  switchWorkspace,
  getWorkspaceKbPath,
  getWorkspaceTablesPath
} from '../workspace'
import { getFileWorkspacePath, setFileWorkspacePath } from '../store/app-config'
import { switchDatabase } from '../database'
import { switchKbDatabase } from '../database/kb'
import { switchTablesDatabase } from '../database/tables'
import { agentRegistry } from '../agents/agent-registry'
import { registerCustomAgentsFromDB } from '../agents/custom-agents.service'
import { mcpManager } from '../mcp/manager'
import { clearAllSessions as clearPiSessions } from '../pi/session-manager'

export function registerWorkspaceIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle('workspace:list', () => {
    return listWorkspaces()
  })

  ipcMain.handle('workspace:current', () => {
    return getCurrentWorkspace()
  })

  ipcMain.handle('workspace:switch', async (_event, id: string) => {
    // 先断开当前工作区的所有 MCP 连接（注销其工具）
    await mcpManager.stopAll()
    // 清空 Pi sessions（不同工作区数据隔离）
    try {
      await clearPiSessions()
    } catch (err) {
      console.warn('[Workspace] Pi sessions clear failed:', err)
    }
    const newDbPath = switchWorkspace(id)
    await switchDatabase(newDbPath)
    // 切换知识库磁盘库（与 data.db 同目录的 kb.db）
    try {
      switchKbDatabase(getWorkspaceKbPath())
    } catch (err) {
      console.error('[Workspace] KB database switch failed:', err)
    }
    // 切换表格数据库（与 data.db 同目录的 tables.db）
    try {
      switchTablesDatabase(getWorkspaceTablesPath())
    } catch (err) {
      console.error('[Workspace] Tables database switch failed:', err)
    }
    // 重新注册自定义 Agent（清除旧工作区的，加载新工作区的）
    agentRegistry.clearCustomAgents()
    registerCustomAgentsFromDB()
    // 启动新工作区的 MCP 服务器
    try {
      await mcpManager.startAll()
    } catch (err) {
      console.warn('[Workspace] MCP servers failed to start after switch:', err)
    }
    // Notify renderer to reload
    mainWindow.webContents.send('workspace:changed', id)
    return { success: true, dbPath: newDbPath }
  })

  ipcMain.handle('workspace:create', async (_event, name: string) => {
    const ws = createWorkspace(name)
    return ws
  })

  ipcMain.handle('workspace:delete', async (_event, id: string) => {
    return deleteWorkspace(id)
  })

  ipcMain.handle('workspace:rename', async (_event, id: string, name: string) => {
    const success = renameWorkspace(id, name)
    return { success }
  })

  // 当前工作区绑定的文件工作空间目录（文件管理器 + Agent 文件工具共用）
  ipcMain.handle('workspace:getFolder', () => {
    return { folder: getFileWorkspacePath() }
  })

  ipcMain.handle('workspace:setFolder', (_event, folder: string) => {
    if (typeof folder !== 'string') return { success: false, error: '目录参数无效' }
    setFileWorkspacePath(folder)
    return { success: true }
  })
}
