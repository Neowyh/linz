import type { DockLayout } from './types'
import { ensureAnchorPane } from './defaultLayout'

const STORAGE_KEY = 'linz.dock.layout.v2'

/** 持久化布局到 localStorage；PTY 会话 id 在重启后失效，序列化时剥离 */
export function saveLayout(l: DockLayout): void {
  try {
    const clone: DockLayout = JSON.parse(JSON.stringify(l))
    for (const key of Object.keys(clone.instances)) {
      delete clone.instances[key].sessionId
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...clone, version: 1 }))
  } catch {
    // 忽略（localStorage 不可用或超限）
  }
}

export function loadLayout(): DockLayout | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as DockLayout
    if (!parsed || parsed.version !== 1 || !parsed.rootId || !parsed.byId) return null
    return ensureAnchorPane(parsed)
  } catch {
    return null
  }
}
