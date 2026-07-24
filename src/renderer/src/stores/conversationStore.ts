import { create } from 'zustand'
import type { ConversationSummary } from '../types/chat'

interface ConversationListState {
  conversations: ConversationSummary[]
  loading: boolean

  fetchConversations: () => Promise<void>
  createConversation: () => Promise<string>
  deleteConversation: (id: string) => Promise<void>
  setConversations: (conversations: ConversationSummary[]) => void
}

export const useConversationStore = create<ConversationListState>((set, get) => ({
  conversations: [],
  loading: false,

  fetchConversations: async () => {
    set({ loading: true })
    try {
      const list = await window.aeromind.conversation.list()
      set({ conversations: list, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createConversation: async () => {
    const conv = await window.aeromind.conversation.create()
    set((state) => ({
      conversations: [conv, ...state.conversations]
    }))
    return conv.id
  },

  deleteConversation: async (id) => {
    await window.aeromind.conversation.delete(id)
    set((state) => ({
      conversations: state.conversations.filter((c) => c.id !== id)
    }))
  },

  setConversations: (conversations) => set({ conversations })
}))
