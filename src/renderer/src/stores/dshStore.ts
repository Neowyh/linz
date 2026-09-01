import { create } from 'zustand'

interface DshPluginInfo {
  name: string
  version: string
  packageDir: string
}

interface DshState {
  port: number | null
  plugins: DshPluginInfo[]
  loadPort: () => Promise<void>
  loadPlugins: () => Promise<void>
}

export const useDshStore = create<DshState>((set) => ({
  port: null,
  plugins: [],

  loadPort: async () => {
    try {
      const port = await window.aeromind.dsh.getPort()
      set({ port })
    } catch {
      // DSH shim not initialized
    }
  },

  loadPlugins: async () => {
    try {
      const plugins = await window.aeromind.dsh.listPlugins()
      set({ plugins })
    } catch {
      // DSH shim not initialized
    }
  }
}))
