// 浏览器面板 IPC：渲染端 BrowserPanel 上报激活页签 guestId，
// 供主进程 browser 工具（browser-session.ts）定位要操作的 webview。
// browser:openPanel 是主→渲染单向通道（webContents.send），无需 ipcMain handler。

import { ipcMain } from 'electron'
import { setActiveBrowserGuest } from '../browser/browser-session'

export function registerBrowserIPC(): void {
  ipcMain.on('browser:activeTab', (_event, guestId: number | null) => {
    setActiveBrowserGuest(typeof guestId === 'number' ? guestId : null)
  })
}
