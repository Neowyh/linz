import { ipcMain, BrowserWindow, WebContents } from 'electron'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'

type PtyModule = typeof import('node-pty')
type PtyProcess = import('node-pty').IPty

interface TerminalSession {
  pty: PtyProcess
  senderId: number
  sender: WebContents
}

const sessions = new Map<string, TerminalSession>()

// node-pty 是 CJS 包。Electron 只给 CJS require 打了 asar 补丁，
// ESM import() 无法解析 app.asar 内的 node_modules，必须用 createRequire。
const nodeRequire = createRequire(__filename)
let ptyModule: PtyModule | null = null

function loadPty(): PtyModule {
  if (!ptyModule) {
    ptyModule = nodeRequire('node-pty') as PtyModule
  }
  return ptyModule
}

function getShellCommand(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'cmd.exe'
  }
  if (process.platform === 'darwin') {
    return process.env.SHELL || 'zsh'
  }
  return process.env.SHELL || 'bash'
}

// 杀死并清理单个会话
function killSession(session: TerminalSession): void {
  try {
    session.pty.kill()
  } catch {
    // 已退出
  }
}

// 清理某个 sender 持有的所有 pty 会话（用于渲染进程重载/崩溃场景）
function killSessionsBySender(senderId: number): void {
  for (const [id, session] of Array.from(sessions.entries())) {
    if (session.senderId === senderId) {
      killSession(session)
      sessions.delete(id)
    }
  }
}

export function registerTerminalIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle('terminal:spawn', async (event, opts: { cwd?: string } = {}) => {
    const pty = loadPty()
    const sessionId = randomUUID()
    const shell = getShellCommand()
    const cwd = opts.cwd || process.cwd()

    let ptyProcess: PtyProcess
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd,
        env: process.env as Record<string, string>
      })
    } catch (err) {
      throw new Error(`Failed to spawn terminal: ${(err as Error).message}`)
    }

    const sender = event.sender
    const senderId = event.sender.id
    sessions.set(sessionId, { pty: ptyProcess, senderId, sender })

    // 渲染进程重载/崩溃时清理该 sender 的所有 pty，避免 cmd.exe/bash 泄漏
    const cleanupOnGone = (): void => {
      killSessionsBySender(senderId)
    }
    sender.once('destroyed', cleanupOnGone)
    sender.once('render-process-gone', cleanupOnGone)

    ptyProcess.onData((data) => {
      try {
        if (!sender.isDestroyed()) {
          sender.send('terminal:data', { sessionId, data })
        }
      } catch {
        // sender 已销毁,忽略
      }
    })

    ptyProcess.onExit(({ exitCode }) => {
      try {
        if (!sender.isDestroyed()) {
          sender.send('terminal:exit', { sessionId, exitCode })
        }
      } catch {
        // sender 已销毁,忽略
      }
      sessions.delete(sessionId)
      sender.removeListener('destroyed', cleanupOnGone)
      sender.removeListener('render-process-gone', cleanupOnGone)
    })

    return { sessionId }
  })

  // 校验 sessionId 归属：只允许创建者 sender 写入/调整/杀死其会话
  const authorize = (event: Electron.IpcMainEvent, sessionId: string): TerminalSession | undefined => {
    const session = sessions.get(sessionId)
    if (!session) return undefined
    if (session.senderId !== event.sender.id) {
      console.warn(`[Terminal] Sender ${event.sender.id} attempted to access session ${sessionId} owned by ${session.senderId}`)
      return undefined
    }
    return session
  }

  ipcMain.on('terminal:write', (event, payload: { sessionId: string; data: string }) => {
    const session = authorize(event, payload.sessionId)
    if (session) {
      try {
        session.pty.write(payload.data)
      } catch {
        // pty 已退出
      }
    }
  })

  ipcMain.on('terminal:resize', (event, payload: { sessionId: string; cols: number; rows: number }) => {
    const session = authorize(event, payload.sessionId)
    if (session) {
      try {
        session.pty.resize(payload.cols, payload.rows)
      } catch {
        // resize 失败不影响主流程
      }
    }
  })

  ipcMain.on('terminal:kill', (event, payload: { sessionId: string }) => {
    const session = authorize(event, payload.sessionId)
    if (session) {
      killSession(session)
      sessions.delete(payload.sessionId)
    }
  })

  mainWindow.on('closed', () => {
    for (const [id, session] of sessions.entries()) {
      killSession(session)
      sessions.delete(id)
    }
  })
}
