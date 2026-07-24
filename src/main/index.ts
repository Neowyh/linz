// Polyfill 已通过 electron.vite.config.ts 的 rollupOptions.output.banner 注入 bundle 顶部
import { app, BrowserWindow } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { is } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { initDatabase, saveDatabase } from './database'
import { seedBuiltinAgentSkills } from './database'
import { refreshSkillCache } from './agents/agent-skills.service'
import { registerAllIPC } from './ipc'
import { registerAllAgents } from './agents'
import { startAllSchedulers, stopAllSchedulers, setMainWindowForScheduler } from './scheduler'
import { createTray, destroyTray } from './tray'
import { initDefaultWorkspace, getWorkspaceDbPath } from './workspace'
import { mcpManager } from './mcp/manager'
import { disposeAll as disposePiSessions } from './pi/session-manager'

// Win7 兼容开关：必须在 app.whenReady() 之前设置
// 1. no-sandbox: Win7 渲染进程 sandbox 不稳定，必须关闭
// 2. disable-gpu: 部分 Win7 老显卡 GPU 渲染会黑屏，关闭走软渲染
// 3. disable-background-timer-throttling / disable-renderer-backgrounding: 防止窗口失焦时 Agent 流被节流
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu')
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.commandLine.appendSwitch('disable-renderer-backgrounding')
app.commandLine.appendSwitch('disable-backgrounding-occluded-windows')
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,MediaSessionService')
app.disableHardwareAcceleration()

let mainWindow: BrowserWindow | null = null
let ipcRegistered = false
let isQuitting = false

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.aeromind')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 初始化默认工作区
  initDefaultWorkspace()

  // 使用工作区数据库路径初始化数据库
  const dbPath = getWorkspaceDbPath()
  const db = await initDatabase(dbPath)

  // 种子内置技能并刷新技能缓存
  try {
    seedBuiltinAgentSkills(db)
    refreshSkillCache()
  } catch (err) {
    console.warn('[Main] Agent skills seed/refresh failed:', err)
  }

  // 注册所有 Agent（不依赖 API Key，使 Office 页面能显示 Agent 列表）
  registerAllAgents()

  // 创建主窗口
  mainWindow = createMainWindow()
  setMainWindowForScheduler(mainWindow)

  // 系统托盘：生产模式下关闭窗口隐藏到托盘，开发模式正常退出
  if (!is.dev) {
    createTray(mainWindow)

    mainWindow.on('close', (e) => {
      if (!isQuitting) {
        e.preventDefault()
        mainWindow!.hide()
      }
    })
  }

  // 注册所有 IPC 处理器（只注册一次）
  if (!ipcRegistered) {
    registerAllIPC(mainWindow)
    ipcRegistered = true
  }

  // 启动所有自动任务调度
  startAllSchedulers()

  // 启动所有已启用的 MCP 服务器（异步，不阻塞应用启动）
  mcpManager.startAll().catch((err) => {
    console.warn('[Main] MCP servers failed to start:', err)
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow()
      setMainWindowForScheduler(mainWindow)
    } else {
      mainWindow?.show()
    }
  })
})

// 退出前标记真正退出，关闭 MCP 连接，保存数据库并停止调度器
app.on('before-quit', async (e) => {
  if (!isQuitting) {
    e.preventDefault()
    isQuitting = true
    try {
      await disposePiSessions()
    } catch (err) {
      console.warn('[Main] Pi sessions dispose failed:', err)
    }
    try {
      await mcpManager.stopAll()
    } catch (err) {
      console.warn('[Main] MCP stopAll failed:', err)
    }
    stopAllSchedulers()
    saveDatabase()
    destroyTray()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
