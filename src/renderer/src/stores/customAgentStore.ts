import { create } from 'zustand'
import type { CustomAgentData, ToolInfo } from '../types/customAgent'

interface CustomAgentState {
  agents: CustomAgentData[]
  builtinAgents: CustomAgentData[]
  availableTools: ToolInfo[]
  loading: boolean
  fetchAgents: () => Promise<void>
  fetchAvailableTools: () => Promise<void>
  createAgent: (params: Record<string, unknown>) => Promise<{ success: boolean; agent?: CustomAgentData; error?: string }>
  updateAgent: (id: string, updates: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  deleteAgent: (id: string) => Promise<{ success: boolean; error?: string }>
  fetchBuiltinAgents: () => Promise<void>
  updateBuiltinAgent: (id: string, updates: any) => Promise<{ success: boolean; error?: string }>
  resetBuiltinAgent: (id: string) => Promise<{ success: boolean; error?: string }>
  exportAgent: (id: string) => Promise<{ success: boolean; filePath?: string; error?: string; canceled?: boolean }>
  importParse: (paths: string[]) => Promise<{ candidates: any[]; errors: string[] }>
  importConfirm: (items: any[]) => Promise<{ success: boolean; imported: number; names: string[]; errors?: string[] }>
}

export const useCustomAgentStore = create<CustomAgentState>((set, get) => ({
  agents: [],
  builtinAgents: [],
  availableTools: [],
  loading: false,

  fetchAgents: async () => {
    set({ loading: true })
    try {
      const agents = await window.aeromind.customAgent.list()
      set({ agents, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  fetchAvailableTools: async () => {
    try {
      const tools = await window.aeromind.agent.availableTools()
      set({ availableTools: tools })
    } catch { /* ignore */ }
  },

  createAgent: async (params) => {
    const result = await window.aeromind.customAgent.create(params)
    if (result.success) {
      await get().fetchAgents()
    }
    return result
  },

  updateAgent: async (id, updates) => {
    const result = await window.aeromind.customAgent.update(id, updates)
    if (result.success) {
      await get().fetchAgents()
    }
    return result
  },

  deleteAgent: async (id) => {
    const result = await window.aeromind.customAgent.delete(id)
    if (result.success) {
      await get().fetchAgents()
    }
    return result
  },

  fetchBuiltinAgents: async () => {
    try {
      const agents = await window.aeromind.customAgent.listBuiltin()
      set({ builtinAgents: agents })
    } catch (err) {
      console.warn('Failed to fetch builtin agents:', err)
    }
  },

  updateBuiltinAgent: async (id, updates) => {
    const result = await window.aeromind.customAgent.updateBuiltin(id, updates)
    if (result.success) {
      await get().fetchBuiltinAgents()
    }
    return result
  },

  resetBuiltinAgent: async (id) => {
    const result = await window.aeromind.customAgent.resetBuiltin(id)
    if (result.success) {
      await get().fetchBuiltinAgents()
    }
    return result
  },

  exportAgent: async (id) => {
    return window.aeromind.customAgent.exportAgent(id)
  },

  importParse: async (paths) => {
    return window.aeromind.customAgent.importParse(paths)
  },

  importConfirm: async (items) => {
    const result = await window.aeromind.customAgent.importConfirm(items)
    if (result.imported > 0) {
      await get().fetchAgents()
    }
    return result
  }
}))
