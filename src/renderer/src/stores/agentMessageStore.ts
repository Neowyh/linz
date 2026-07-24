import { create } from 'zustand'

export interface AgentMessageItem {
  id: string
  fromAgent: string
  toAgent: string | 'all'
  type: 'request' | 'response' | 'notification'
  content: string
  params?: Record<string, unknown>
  confidence?: number
  timestamp: number
}

interface AgentMessageState {
  messages: AgentMessageItem[]
  // agentType -> 最近一次收/发消息的时间戳；OfficePage 通过 Date.now() - lastActiveAt[t] < 2000 判断是否高亮
  lastActiveAt: Record<string, number>
  addMessage: (msg: AgentMessageItem) => void
  clearMessages: () => void
}

const MAX_MESSAGES = 50
export const ACTIVE_HIGHLIGHT_MS = 2000

export const useAgentMessageStore = create<AgentMessageState>((set) => ({
  messages: [],
  lastActiveAt: {},

  addMessage: (msg) =>
    set((state) => {
      const next = [msg, ...state.messages]
      if (next.length > MAX_MESSAGES) next.length = MAX_MESSAGES
      const nextActive = { ...state.lastActiveAt }
      nextActive[msg.fromAgent] = msg.timestamp
      if (msg.toAgent !== 'all') nextActive[msg.toAgent] = msg.timestamp
      return { messages: next, lastActiveAt: nextActive }
    }),

  clearMessages: () => set({ messages: [], lastActiveAt: {} })
}))
