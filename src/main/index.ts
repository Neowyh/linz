// Polyfill 已通过 electron.vite.config.ts 的 rollupOptions.output.banner 注入 bundle 顶部
import { app, BrowserWindow, dialog } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { is } from '@electron-toolkit/utils'
import { createMainWindow } from './window'
import { initDatabase, saveDatabase } from './database'
import { seedBuiltinAgentSkills } from './database'
import { getAppConfig } from './store/app-config'
import { initKbDatabase, closeKbDatabase, migrateLegacyKb } from './database/kb'
import { initTablesDatabase, closeTablesDatabase } from './database/tables'
import { refreshSkillCache } from './agents/agent-skills.service'
import { registerAllIPC } from './ipc'
import { registerAllAgents } from './agents'
import { startAllSchedulers, stopAllSchedulers, setMainWindowForScheduler } from './scheduler'
import { createTray, destroyTray } from './tray'
import { setupAppMenu } from './menu'
import { initDefaultWorkspace, getWorkspaceDbPath, getWorkspaceKbPath, getWorkspaceTablesPath } from './workspace'
import { mcpManager } from './mcp/manager'
import { disposeAll as disposePiSessions } from './pi/session-manager'
import { initDshShim, disposeDshShim } from './dsh'

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

// 侧边栏浏览器 webview 里 target="_blank" / window.open 的跳转：
// Electron 22 已移除 webContents/webview 的 new-window 事件，必须用 setWindowOpenHandler，
// 否则点击这类链接毫无反应。目标地址不在此处加载，而是转发给宿主渲染进程，
// 由 BrowserPanel 为它新建一个标签页（仅 http/https）；宿主不可用时兜底在当前 webview 内打开。
app.on('web-contents-created', (_event, contents) => {
  console.log('[Browser] web-contents-created type=', contents.getType(), 'id=', contents.id)
  if (contents.getType() !== 'webview') return
  const installHandler = (): void => {
    console.log('[Browser] install windowOpenHandler on guest', contents.id)
    contents.setWindowOpenHandler(({ url }) => {
      console.log('[Browser] windowOpenHandler:', url)
      if (/^https?:\/\//i.test(url)) {
        const host = contents.hostWebContents
        if (host && !host.isDestroyed()) {
          host.send('browser:openInNewTab', { url, guestId: contents.id })
        } else {
          contents.loadURL(url).catch(() => {})
        }
      }
      return { action: 'deny' }
    })
  }
  installHandler()
  // guest-view-manager 在 webview attach 时会覆盖 guest 的 windowOpenHandler，
  // dom-ready 时重新安装（此时 attach 已完成）
  contents.on('dom-ready', installHandler)
})

let mainWindow: BrowserWindow | null = null
let ipcRegistered = false
let isQuitting = false

app.whenReady().then(async () => {
  // 与 electron-builder.yml 的 appId 保持一致，确保 Windows 任务栏分组与通知归属正确
  electronApp.setAppUserModelId('com.linz.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // 初始化默认工作区
  initDefaultWorkspace()

  // 使用工作区数据库路径初始化数据库
  const dbPath = getWorkspaceDbPath()
  const db = await initDatabase(dbPath)

  // 初始化知识库磁盘库（better-sqlite3 + FTS5），并迁移 sql.js 中的旧 KB 数据
  try {
    initKbDatabase(getWorkspaceKbPath())
    migrateLegacyKb(db)
  } catch (err) {
    console.error('[Main] KB database init failed:', err)
  }

  // 初始化表格数据库（导入的 xlsx/csv 等结构化数据）
  try {
    initTablesDatabase(getWorkspaceTablesPath())
  } catch (err) {
    console.error('[Main] Tables database init failed:', err)
  }

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

  // 中文应用菜单（文件/编辑/视图/导航/窗口/帮助）
  setupAppMenu()

  // 系统托盘：生产模式下默认关闭窗口隐藏到托盘；设置 quitOnClose 后关闭窗口即退出进程
  if (!is.dev) {
    createTray(mainWindow)

    mainWindow.on('close', (e) => {
      if (!isQuitting && !getAppConfig().get('quitOnClose')) {
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

  // 初始化 DSH 兼容层（内嵌 HTTP 服务器 + 会话适配器 + 插件加载器）
  // 在 IPC 注册之后启动，以便 dsh.ipc.ts 的处理器可用
  initDshShim(() => mainWindow).catch((err) => {
    console.warn('[Main] DSH shim init failed:', err)
  })

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
}).catch((err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  console.error('[App] 启动失败:', err)
  try {
    dialog.showErrorBox('应用启动失败', `初始化过程中出错：${msg}\n\n请检查工作区与数据库权限后重试。`)
  } catch {}
  app.exit(1)
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
    try {
      await disposeDshShim()
    } catch (err) {
      console.warn('[Main] DSH shim dispose failed:', err)
    }
    stopAllSchedulers()
    saveDatabase()
    closeKbDatabase()
    closeTablesDatabase()
    destroyTray()
    app.quit()
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
