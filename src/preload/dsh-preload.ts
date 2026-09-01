import { contextBridge, ipcRenderer } from 'electron'

/**
 * DSH webview preload — exposes `window.dshBridge` for DSH plugin host pages.
 *
 * Maps the DSH client runtime API (ctx.sessions, ctx.workspaces) to AeroMind's
 * IPC channels so the bridge script in the host page can drive conversations,
 * forking, and live-reply without DSH's native client runtime.
 */

interface DshSessionInfo {
  id: string
  displayTitle: string
  cwd: string | null
  parentId?: string | null
  blank?: boolean
}

interface DshSessionState {
  partial: { blocks: Array<{ kind: string; text: string }> }
  running: boolean
  chat: { nodes: Map<string, unknown> }
}

interface DshWorkspace {
  workspaceId: string
  title: string
  path: string | null
  sessionIds: string[]
}

const api = {
  // ── Sessions ──────────────────────────────────────────────
  getCurrentSession: async (): Promise<DshSessionInfo | null> => {
    const snapshot = await ipcRenderer.invoke('dsh:listSessions') as {
      ids: string[]
      byId: Record<string, DshSessionInfo>
      current?: string
    }
    if (!snapshot.current) return null
    return snapshot.byId[snapshot.current] ?? null
  },

  listSessions: async (): Promise<DshSessionInfo[]> => {
    const snapshot = await ipcRenderer.invoke('dsh:listSessions') as {
      ids: string[]
      byId: Record<string, DshSessionInfo>
    }
    return snapshot.ids.map((id) => snapshot.byId[id]).filter(Boolean)
  },

  subscribeSessions: (cb: (sessions: DshSessionInfo[]) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: unknown): void => {
      cb(data as DshSessionInfo[])
    }
    ipcRenderer.on('dsh:sessionsChanged', handler)
    return () => {
      ipcRenderer.removeListener('dsh:sessionsChanged', handler)
    }
  },

  subscribeSession: async (sessionId: string, cb: (state: DshSessionState) => void): Promise<boolean> => {
    const ok = await ipcRenderer.invoke('dsh:subscribeSession', sessionId)
    if (!ok) return false
    const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; state: DshSessionState }): void => {
      if (data.sessionId === sessionId) cb(data.state)
    }
    ipcRenderer.on('dsh:sessionStateChanged', handler)
    return true
  },

  prompt: async (sessionId: string, text: string): Promise<{ ok: boolean; error?: { message?: string } }> => {
    return ipcRenderer.invoke('dsh:prompt', sessionId, text)
  },

  fork: async (sessionId: string, atSeq?: number): Promise<{ id: string; title: string }> => {
    return ipcRenderer.invoke('dsh:fork', sessionId, atSeq)
  },

  createSession: async (cwd?: string): Promise<{ id: string; title: string; cwd: string | null }> => {
    return ipcRenderer.invoke('dsh:createSession', cwd)
  },

  openSession: (sessionId: string): void => {
    ipcRenderer.invoke('dsh:openSession', sessionId)
  },

  // ── Workspaces ────────────────────────────────────────────
  listWorkspaces: async (): Promise<DshWorkspace[]> => {
    const snapshot = await ipcRenderer.invoke('dsh:listWorkspaces') as { items: DshWorkspace[] }
    return snapshot.items
  },

  subscribeWorkspaces: async (cb: (workspaces: DshWorkspace[]) => void): Promise<() => void> => {
    const snapshot = await ipcRenderer.invoke('dsh:subscribeWorkspaces') as { items: DshWorkspace[] }
    cb(snapshot.items)
    const handler = (_event: Electron.IpcRendererEvent, data: { items: DshWorkspace[] }): void => {
      cb(data.items)
    }
    ipcRenderer.on('dsh:workspacesChanged', handler)
    return () => {
      ipcRenderer.removeListener('dsh:workspacesChanged', handler)
    }
  },

  // ── Live reply ────────────────────────────────────────────
  getLiveReply: async (sessionId: string): Promise<{ running: boolean; text: string } | null> => {
    return ipcRenderer.invoke('dsh:getLiveReply', sessionId)
  },

  // ── Theme ────────────────────────────────────────────────
  getTheme: async (): Promise<{ dark: boolean }> => {
    return ipcRenderer.invoke('dsh:getTheme')
  },

  subscribeTheme: (cb: (theme: { dark: boolean }) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { dark: boolean }): void => {
      cb(data)
    }
    ipcRenderer.on('dsh:themeChanged', handler)
    return () => {
      ipcRenderer.removeListener('dsh:themeChanged', handler)
    }
  },

  // ── Open session request (from host to main renderer) ────
  onOpenSessionRequest: (cb: (sessionId: string) => void): (() => void) => {
    const handler = (_event: Electron.IpcRendererEvent, sessionId: string): void => {
      cb(sessionId)
    }
    ipcRenderer.on('dsh:openSessionRequest', handler)
    return () => {
      ipcRenderer.removeListener('dsh:openSessionRequest', handler)
    }
  }
}

contextBridge.exposeInMainWorld('dshBridge', api)
