import { create } from 'zustand'
import type { AgentStatusData } from '../types/agent'
import { AGENT_NAMES, AGENT_COLORS } from '../types/agent'
import type { BuiltinAgentType } from '../types/agent'

interface AgentState {
  agents: AgentStatusData[]
  totalTokensUsed: number
  activeTasks: number
  completedTasks: number

  loadAgents: () => Promise<void>
  updateAgentStatus: (data: AgentStatusData) => void
  setAgents: (agents: AgentStatusData[]) => void
  resetAll: () => void
  addTokens: (tokens: number) => void
  incrementActiveTasks: () => void
  incrementCompletedTasks: () => void
}

const INITIAL_AGENTS: AgentStatusData[] = (Object.keys(AGENT_NAMES) as BuiltinAgentType[]).map((type) => ({
  agentType: type,
  name: AGENT_NAMES[type],
  color: AGENT_COLORS[type],
  state: 'idle' as const
}))

export const useAgentStore = create<AgentState>((set) => ({
  agents: INITIAL_AGENTS,
  totalTokensUsed: 0,
  activeTasks: 0,
  completedTasks: 0,

  loadAgents: async () => {
    try {
      const states = await window.aeromind.agent.listStates()
      if (states && states.length > 0) {
        set({ agents: states })
      }
    } catch { /* fall back to initial agents */ }
  },

  updateAgentStatus: (data) =>
    set((state) => ({
      agents: state.agents.map((a) => (a.agentType === data.agentType ? { ...a, ...data } : a))
    })),

  setAgents: (agents) => set({ agents }),

  resetAll: () =>
    set({
      agents: INITIAL_AGENTS.map((a) => ({ ...a, state: 'idle' as const, currentTask: undefined })),
      activeTasks: 0
    }),

  addTokens: (tokens) => set((state) => ({ totalTokensUsed: state.totalTokensUsed + tokens })),

  incrementActiveTasks: () => set((state) => ({ activeTasks: state.activeTasks + 1 })),

  incrementCompletedTasks: () =>
    set((state) => ({
      completedTasks: state.completedTasks + 1,
      activeTasks: Math.max(0, state.activeTasks - 1)
    }))
}))
