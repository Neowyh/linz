import { create } from 'zustand'
import type { AgentSkillData } from '../types/agentSkill'

interface AgentSkillState {
  skills: AgentSkillData[]
  loading: boolean
  fetchSkills: () => Promise<void>
  createSkill: (params: {
    name: string; description?: string; content: string;
    targetAgents?: string[]; triggerKeywords?: string[];
    priority?: number; enabled?: boolean
  }) => Promise<{ success: boolean; skill?: AgentSkillData; error?: string }>
  updateSkill: (id: string, updates: Record<string, unknown>) => Promise<{ success: boolean; error?: string }>
  deleteSkill: (id: string) => Promise<{ success: boolean; error?: string }>
  toggleSkill: (id: string, enabled: boolean) => Promise<{ success: boolean; error?: string }>
}

export const useAgentSkillStore = create<AgentSkillState>((set, get) => ({
  skills: [],
  loading: false,

  fetchSkills: async () => {
    set({ loading: true })
    try {
      const skills = await window.aeromind.agentSkill.list()
      set({ skills, loading: false })
    } catch {
      set({ loading: false })
    }
  },

  createSkill: async (params) => {
    const result = await window.aeromind.agentSkill.create(params)
    if (result.success) {
      await get().fetchSkills()
    }
    return result
  },

  updateSkill: async (id, updates) => {
    const result = await window.aeromind.agentSkill.update(id, updates)
    if (result.success) {
      await get().fetchSkills()
    }
    return result
  },

  deleteSkill: async (id) => {
    const result = await window.aeromind.agentSkill.delete(id)
    if (result.success) {
      await get().fetchSkills()
    }
    return result
  },

  toggleSkill: async (id, enabled) => {
    const result = await window.aeromind.agentSkill.toggle(id, enabled)
    if (result.success) {
      await get().fetchSkills()
    }
    return result
  }
}))
