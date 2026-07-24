import { create } from 'zustand'
import type { McpServer, McpToolInfo, McpTemplate, McpTestResult, McpServerFormValues } from '../types/mcp'

interface McpState {
  servers: McpServer[]
  templates: McpTemplate[]
  serverTools: Record<string, McpToolInfo[]>
  loading: boolean
  testing: boolean

  fetchServers: () => Promise<void>
  fetchTemplates: () => Promise<void>
  fetchTools: (serverId: string) => Promise<McpToolInfo[]>
  createServer: (params: McpServerFormValues & { autoConnect?: boolean }) => Promise<{ success: boolean; server?: McpServer; error?: string }>
  updateServer: (id: string, updates: Partial<McpServerFormValues>) => Promise<{ success: boolean; server?: McpServer; error?: string }>
  deleteServer: (id: string) => Promise<{ success: boolean; error?: string }>
  testConnection: (config: McpServerFormValues) => Promise<McpTestResult>
  connect: (id: string) => Promise<{ success: boolean; toolCount?: number; error?: string }>
  disconnect: (id: string) => Promise<{ success: boolean; error?: string }>
}

export const useMcpStore = create<McpState>((set, get) => ({
  servers: [],
  templates: [],
  serverTools: {},
  loading: false,
  testing: false,

  fetchServers: async () => {
    set({ loading: true })
    try {
      const servers = await window.aeromind.mcp.list()
      set({ servers, loading: false })
    } catch (err) {
      console.warn('[McpStore] fetchServers failed:', err)
      set({ loading: false })
    }
  },

  fetchTemplates: async () => {
    try {
      const templates = await window.aeromind.mcp.listTemplates()
      set({ templates })
    } catch (err) {
      console.warn('[McpStore] fetchTemplates failed:', err)
    }
  },

  fetchTools: async (serverId: string) => {
    try {
      const tools = await window.aeromind.mcp.listTools(serverId)
      set((state) => ({
        serverTools: { ...state.serverTools, [serverId]: tools }
      }))
      return tools
    } catch (err) {
      console.warn('[McpStore] fetchTools failed:', err)
      return []
    }
  },

  createServer: async (params) => {
    const result = await window.aeromind.mcp.create(params)
    if (result.success) {
      await get().fetchServers()
    }
    return result
  },

  updateServer: async (id, updates) => {
    const result = await window.aeromind.mcp.update(id, updates)
    if (result.success) {
      await get().fetchServers()
    }
    return result
  },

  deleteServer: async (id) => {
    const result = await window.aeromind.mcp.delete(id)
    if (result.success) {
      await get().fetchServers()
    }
    return result
  },

  testConnection: async (config) => {
    set({ testing: true })
    try {
      const result = await window.aeromind.mcp.testConnection(config)
      return result
    } finally {
      set({ testing: false })
    }
  },

  connect: async (id) => {
    const result = await window.aeromind.mcp.connect(id)
    if (result.success) {
      await get().fetchServers()
    }
    return result
  },

  disconnect: async (id) => {
    const result = await window.aeromind.mcp.disconnect(id)
    if (result.success) {
      await get().fetchServers()
    }
    return result
  }
}))
