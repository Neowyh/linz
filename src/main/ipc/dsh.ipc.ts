import { ipcMain, app, type BrowserWindow } from 'electron'
import path from 'node:path'
import {
  getDshPort,
  getDshContext,
  getSessionService,
  getWorkspaceService,
  getPluginLoader
} from '../dsh'
import { getConversationsRepo } from '../database'
import type { SessionListSnapshot, SessionStateSnapshot, WorkspaceListSnapshot } from '../dsh/types'

export function registerDshIPC(mainWindow: BrowserWindow): void {
  // ── Plugin management ──────────────────────────────────────

  ipcMain.handle('dsh:getPort', async () => {
    return getDshPort()
  })

  ipcMain.handle('dsh:getConfig', async () => {
    return {
      port: getDshPort(),
      preloadPath: path.join(app.getAppPath(), 'out', 'preload', 'dsh-preload.js')
    }
  })

  ipcMain.handle('dsh:listPlugins', async () => {
    return getPluginLoader()?.listPlugins() ?? []
  })

  ipcMain.handle('dsh:installPlugin', async (_event, packageDir: string) => {
    const loader = getPluginLoader()
    const ctx = getDshContext()
    if (!loader || !ctx) return { success: false, error: 'DSH shim not initialized' }
    try {
      const name = await loader.loadPlugin(packageDir)
      return { success: true, name }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Session list ────────────────────────────────────────────

  ipcMain.handle('dsh:listSessions', async () => {
    return getSessionService()?.getListSnapshot() ?? { ids: [], byId: {} }
  })

  ipcMain.handle('dsh:subscribeSessions', async (event) => {
    // Return the current snapshot; the SPA polls the REST API for updates.
    // Reactive push can be added later if needed.
    const snapshot = getSessionService()?.getListSnapshot() ?? { ids: [], byId: {} }
    return snapshot
  })

  // ── Session detail + live state ────────────────────────────

  ipcMain.handle('dsh:getSession', async (_event, sessionId: string) => {
    const svc = getSessionService()
    if (!svc) return null
    const sessions = svc.list()
    return sessions.find((s) => s.id === sessionId) ?? null
  })

  ipcMain.handle('dsh:subscribeSession', async (event, sessionId: string) => {
    const svc = getSessionService()
    if (!svc) return false
    const handle = svc.sessionOf(sessionId)
    if (!handle) return false

    const unsubscribe = handle.subscribe((state: SessionStateSnapshot) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('dsh:sessionStateChanged', { sessionId, state })
      }
    })
    event.sender.once('destroyed', () => unsubscribe())
    return true
  })

  ipcMain.handle('dsh:getLiveReply', async (_event, sessionId: string) => {
    const svc = getSessionService()
    if (!svc) return null
    const handle = svc.sessionOf(sessionId)
    if (!handle) return null
    const snapshot = handle.getSnapshot()
    return {
      running: snapshot.running,
      text: snapshot.partial.blocks.map((b) => b.text).join('\n')
    }
  })

  // ── Session lifecycle ──────────────────────────────────────

  ipcMain.handle('dsh:prompt', async (_event, sessionId: string, text: string) => {
    const svc = getSessionService()
    if (!svc) return { ok: false, error: { message: 'DSH shim not initialized' } }
    const handle = svc.sessionOf(sessionId)
    if (!handle) return { ok: false, error: { message: '会话不存在' } }
    return handle.prompt([{ type: 'text', text }], 'queue')
  })

  ipcMain.handle('dsh:fork', async (_event, sessionId: string, atSeq?: number) => {
    const svc = getSessionService()
    if (!svc) return { id: '', title: '' }
    try {
      const newId = await svc.fork({ sessionId, atSeq, increaseTitle: true })
      const conv = getConversationsRepo().getById(newId)
      return { id: newId, title: conv?.title ?? '分支' }
    } catch (err) {
      return { id: '', title: '', error: String(err) }
    }
  })

  ipcMain.handle('dsh:createSession', async (_event, cwd?: string) => {
    const svc = getSessionService()
    if (!svc) return { id: '', title: '', cwd: null }
    const newId = await svc.create(cwd ? { cwd } : {})
    const conv = getConversationsRepo().getById(newId)
    return { id: newId, title: conv?.title ?? '新对话', cwd: conv?.cwd ?? null }
  })

  ipcMain.handle('dsh:openSession', async (_event, sessionId: string) => {
    const svc = getSessionService()
    if (!svc) return
    try {
      svc.open(sessionId)
      // Notify the main window's renderer (not the webview) to switch conversations
      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('dsh:openSessionRequest', sessionId)
      }
    } catch {
      // Session not found — ignore
    }
  })

  // ── Workspaces ──────────────────────────────────────────────

  ipcMain.handle('dsh:listWorkspaces', async () => {
    return getWorkspaceService()?.list.getSnapshot() ?? { items: [] }
  })

  ipcMain.handle('dsh:subscribeWorkspaces', async (event) => {
    const ws = getWorkspaceService()
    if (!ws) return { items: [] }
    const snapshot = ws.list.getSnapshot()
    const unsubscribe = ws.list.subscribe((s: WorkspaceListSnapshot) => {
      if (!event.sender.isDestroyed()) {
        event.sender.send('dsh:workspacesChanged', s)
      }
    })
    event.sender.once('destroyed', () => unsubscribe())
    return snapshot
  })

  // ── Theme ───────────────────────────────────────────────────

  ipcMain.handle('dsh:getTheme', async () => {
    // AeroMind doesn't have DSH's data-ds-dark-theme attribute;
    // read from app config instead.
    try {
      const { getAppConfig } = await import('../store/app-config')
      const theme = getAppConfig().get('theme')
      return { dark: theme === 'dark' }
    } catch {
      return { dark: false }
    }
  })
}
