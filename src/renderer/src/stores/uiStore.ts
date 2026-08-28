import { create } from 'zustand'
import { useDockStore } from '../dock/dockStore'

export type RightPanelTab = 'home' | 'browser' | 'terminal' | 'files'

export interface PanelInstance {
  id: string
  title: string
}

let instanceSeq = 0
function genId(prefix: string): string {
  instanceSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${instanceSeq}`
}

// 右侧工具面板显示状态持久化（配合 dock 布局一同记忆，重启后恢复用户选定的排布）
const COMPANION_VISIBLE_KEY = 'linz.ui.companion.visible'
function loadCompanionVisible(): boolean {
  try {
    return localStorage.getItem(COMPANION_VISIBLE_KEY) === '1'
  } catch {
    return false
  }
}

function defaultTitle(kind: 'browser' | 'terminal', index: number): string {
  return kind === 'browser' ? `浏览器 ${index}` : `终端 ${index}`
}

interface UIState {
  rightPanelOpen: boolean
  rightPanelActiveTab: RightPanelTab
  rightPanelWidth: number
  rightPanelFullscreen: boolean
  isPanelResizing: boolean

  leftPanelOpen: boolean

  /** Dock 工作区：是否显示伴随窗格（对话锚点之外的浏览器/终端/文件/...） */
  companionPanesVisible: boolean

  // 跨页面"带上下文发起对话"的待发送提示词（知识图谱联动 → ChatPage 消费后清空）
  pendingChatPrompt: string | null

  browserInstances: PanelInstance[]
  activeBrowserId: string | null
  terminalInstances: PanelInstance[]
  activeTerminalId: string | null

  setRightPanelOpen: (open: boolean) => void
  toggleRightPanel: () => void
  setRightPanelActiveTab: (tab: RightPanelTab) => void
  setRightPanelWidth: (width: number) => void
  toggleFullscreen: () => void
  setPanelResizing: (v: boolean) => void

  setLeftPanelOpen: (open: boolean) => void
  toggleLeftPanel: () => void

  setCompanionPanesVisible: (v: boolean) => void
  toggleCompanionPanes: () => void

  setPendingChatPrompt: (prompt: string | null) => void

  addBrowser: () => string
  removeBrowser: (id: string) => void
  setActiveBrowser: (id: string) => void
  renameBrowser: (id: string, title: string) => void

  addTerminal: () => string
  removeTerminal: (id: string) => void
  setActiveTerminal: (id: string) => void
  renameTerminal: (id: string, title: string) => void
}

const MIN_WIDTH = 360
const MAX_WIDTH = 800
const DEFAULT_WIDTH = 480

const initialBrowserId = genId('browser')
const initialTerminalId = genId('terminal')

export const useUIStore = create<UIState>((set, get) => ({
  rightPanelOpen: false,
  rightPanelActiveTab: 'home',
  rightPanelWidth: DEFAULT_WIDTH,
  rightPanelFullscreen: false,
  isPanelResizing: false,
  leftPanelOpen: true,
  companionPanesVisible: loadCompanionVisible(),
  pendingChatPrompt: null,

  browserInstances: [{ id: initialBrowserId, title: defaultTitle('browser', 1) }],
  activeBrowserId: initialBrowserId,
  terminalInstances: [{ id: initialTerminalId, title: defaultTitle('terminal', 1) }],
  activeTerminalId: initialTerminalId,

  setRightPanelOpen: (open) => set({ rightPanelOpen: open }),
  toggleRightPanel: () => set((state) => ({ rightPanelOpen: !state.rightPanelOpen })),
  setRightPanelActiveTab: (tab) => set({ rightPanelActiveTab: tab }),
  setRightPanelWidth: (width) =>
    set({ rightPanelWidth: Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width)) }),
  toggleFullscreen: () => set((state) => ({ rightPanelFullscreen: !state.rightPanelFullscreen })),
  setPanelResizing: (v) => set({ isPanelResizing: v }),

  setLeftPanelOpen: (open) => set({ leftPanelOpen: open }),
  toggleLeftPanel: () => set((state) => ({ leftPanelOpen: !state.leftPanelOpen })),

  setCompanionPanesVisible: (v) => {
    // 显示前确保 dock 布局里有可展示的窗格；否则曾关闭过的右侧面板会"点了没反应"
    if (v) useDockStore.getState().restoreToolsPane()
    set({ companionPanesVisible: v })
  },
  toggleCompanionPanes: () => {
    const next = !get().companionPanesVisible
    // 打开时若布局中已无任何辅助窗格，先恢复默认"工具"窗格（浏览器/终端/文件）
    if (next) useDockStore.getState().restoreToolsPane()
    set({ companionPanesVisible: next })
  },

  setPendingChatPrompt: (prompt) => set({ pendingChatPrompt: prompt }),

  addBrowser: () => {
    const id = genId('browser')
    const index = get().browserInstances.length + 1
    set((state) => ({
      browserInstances: [...state.browserInstances, { id, title: defaultTitle('browser', index) }],
      activeBrowserId: id
    }))
    return id
  },
  removeBrowser: (id) => {
    set((state) => {
      const remaining = state.browserInstances.filter((b) => b.id !== id)
      let nextActive = state.activeBrowserId
      if (state.activeBrowserId === id) {
        nextActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null
      }
      return { browserInstances: remaining, activeBrowserId: nextActive }
    })
  },
  setActiveBrowser: (id) => set({ activeBrowserId: id }),
  renameBrowser: (id, title) =>
    set((state) => ({
      browserInstances: state.browserInstances.map((b) =>
        b.id === id ? { ...b, title } : b
      )
    })),

  addTerminal: () => {
    const id = genId('terminal')
    const index = get().terminalInstances.length + 1
    set((state) => ({
      terminalInstances: [...state.terminalInstances, { id, title: defaultTitle('terminal', index) }],
      activeTerminalId: id
    }))
    return id
  },
  removeTerminal: (id) => {
    set((state) => {
      const remaining = state.terminalInstances.filter((t) => t.id !== id)
      let nextActive = state.activeTerminalId
      if (state.activeTerminalId === id) {
        nextActive = remaining.length > 0 ? remaining[remaining.length - 1].id : null
      }
      return { terminalInstances: remaining, activeTerminalId: nextActive }
    })
  },
  setActiveTerminal: (id) => set({ activeTerminalId: id }),
  renameTerminal: (id, title) =>
    set((state) => ({
      terminalInstances: state.terminalInstances.map((t) =>
        t.id === id ? { ...t, title } : t
      )
    }))
}))

export const RIGHT_PANEL_MIN_WIDTH = MIN_WIDTH
export const RIGHT_PANEL_MAX_WIDTH = MAX_WIDTH
