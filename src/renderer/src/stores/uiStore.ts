import { create } from 'zustand'

export type RightPanelTab = 'home' | 'browser' | 'terminal'

export interface PanelInstance {
  id: string
  title: string
}

let instanceSeq = 0
function genId(prefix: string): string {
  instanceSeq += 1
  return `${prefix}-${Date.now().toString(36)}-${instanceSeq}`
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
