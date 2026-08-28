import { create } from 'zustand'
import type { PanelTypeId } from '../dock/types'
import { useDockStore } from '../dock/dockStore'
import { useUIStore } from './uiStore'

/**
 * 面板指令（对话→面板）：由 Agent 流式产出的 ⟪PANEL⟫ 标记解析而来，
 * 经 chat.ipc 转发到 chat:streamChunk.panelActions，useStreaming 再 dispatch 到本 store。
 * 面板组件订阅 pending 里属于自己 panelType 的命令，执行后 consume。
 */

let cmdSeq = 0
function genCmdId(): string {
  cmdSeq += 1
  return `panelcmd-${Date.now().toString(36)}-${cmdSeq}`
}

export interface PanelCommand {
  id: string
  panelType: PanelTypeId | string  // 'browser'|'terminal'|'files'|'kb'|'viewer3d'|'field'|'sql'
  action: string  // 'open'|'load'|'navigate'|'search'|'ask'|'run'...
  payload: Record<string, unknown>  // { path?, url?, query?, zone?, var?, docIds? }
  sourceMessageId?: string  // 来自哪条对话消息（双向高亮回溯）
  instanceId?: string  // 多实例面板路由到指定实例；空=聚焦/新建
  createdAt: number
}

interface PanelCommandState {
  /** 待消费命令队列（FIFO）——面板挂载后从中取属于自己的命令 */
  pending: PanelCommand[]
  /** 已消费命令（cap 50，供"消息↔面板"双向高亮回溯） */
  history: PanelCommand[]
  /** 入队：自动打开对应 dock 面板，然后放进待消费队列 */
  dispatch: (cmd: Omit<PanelCommand, 'id' | 'createdAt'>) => void
  /** 面板拿走命令后标记已消费（移到 history） */
  consume: (id: string) => void
  /** 丢弃某条命令（面板无法处理时） */
  discard: (id: string) => void
  clear: () => void
}

const HISTORY_CAP = 50

function pushHistory(history: PanelCommand[], cmd: PanelCommand): PanelCommand[] {
  const next = [...history, cmd]
  return next.length > HISTORY_CAP ? next.slice(next.length - HISTORY_CAP) : next
}

export const usePanelCommandStore = create<PanelCommandState>((set) => ({
  pending: [],
  history: [],

  dispatch: (cmd) => {
    const full: PanelCommand = { ...cmd, id: genCmdId(), createdAt: Date.now() }

    // 先确保伴随窗格可见（内部会 restoreToolsPane），再打开/聚焦对应面板类型
    const ui = useUIStore.getState()
    if (!ui.companionPanesVisible) ui.setCompanionPanesVisible(true)
    useDockStore.getState().openPanelType(full.panelType as PanelTypeId)

    set((s) => ({ pending: [...s.pending, full] }))
  },

  consume: (id) =>
    set((s) => {
      const idx = s.pending.findIndex((c) => c.id === id)
      if (idx < 0) return {}
      const [cmd] = s.pending.splice(idx, 1)
      return { pending: [...s.pending], history: pushHistory(s.history, cmd) }
    }),

  discard: (id) =>
    set((s) => {
      const idx = s.pending.findIndex((c) => c.id === id)
      if (idx < 0) return {}
      s.pending.splice(idx, 1)
      return { pending: [...s.pending] }
    }),

  clear: () => set({ pending: [] })
}))
