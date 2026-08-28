import { create } from 'zustand'
import type { AgentType } from '../types/agent'

export interface PendingApproval {
  requestId: string
  messageId?: string
  toolName: string
  risk: string
  argsSummary: string
  agentType: AgentType
  agentName: string
  agentColor: string
  timestamp: number
}

interface ApprovalState {
  pending: Record<string, PendingApproval>
  addPending: (approval: PendingApproval) => void
  removePending: (requestId: string) => void
  clearAll: () => void
}

export const useApprovalStore = create<ApprovalState>((set) => ({
  pending: {},

  addPending: (approval) =>
    set((state) => ({
      pending: { ...state.pending, [approval.requestId]: approval }
    })),

  removePending: (requestId) =>
    set((state) => {
      const next = { ...state.pending }
      delete next[requestId]
      return { pending: next }
    }),

  clearAll: () => set({ pending: {} })
}))
