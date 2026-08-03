// 渲染端全局 webview 注册表：guest webContents id → 打开新标签页的回调。
// 主进程 window.open 事件只携带 guestId，需要用它定位到对应 BrowserPanel 页签。
type OpenTabHandler = (url: string) => void

const registry = new Map<number, OpenTabHandler>()

export function registerWebview(guestId: number, handler: OpenTabHandler): void {
  registry.set(guestId, handler)
}

export function unregisterWebview(guestId: number): void {
  registry.delete(guestId)
}

export function getWebviewHandler(guestId: number): OpenTabHandler | undefined {
  return registry.get(guestId)
}
