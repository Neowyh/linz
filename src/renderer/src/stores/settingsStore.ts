import { create } from 'zustand'

interface OllamaState {
  baseURL: string
  modelName: string
  enabled: boolean
}

interface SettingsState {
  apiKey: string
  modelProvider: string
  modelName: string
  baseURL: string
  isConfigured: boolean
  showSettings: boolean
  theme: 'light' | 'dark' | 'system'
  ollama: OllamaState

  loadSettings: () => Promise<void>
  setApiKey: (key: string) => Promise<void>
  setShowSettings: (show: boolean) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>
  setOllama: (config: Partial<OllamaState>) => Promise<void>
  updateSettings: (settings: Partial<SettingsState>) => void
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiKey: '',
  modelProvider: 'deepseek',
  modelName: 'deepseek-chat',
  baseURL: 'https://api.deepseek.com',
  isConfigured: false,
  showSettings: false,
  theme: 'system',
  ollama: {
    baseURL: 'http://localhost:11434',
    modelName: 'qwen2.5:7b',
    enabled: false
  },

  loadSettings: async () => {
    const [apiKey, modelProvider, modelName, baseURL, theme, ollama] = await Promise.all([
      window.aeromind.settings.get('apiKey'),
      window.aeromind.settings.get('modelProvider'),
      window.aeromind.settings.get('modelName'),
      window.aeromind.settings.get('baseURL'),
      window.aeromind.settings.get('theme'),
      window.aeromind.settings.get('ollama')
    ])
    set({
      apiKey: apiKey || '',
      modelProvider: modelProvider || 'deepseek',
      modelName: modelName || 'deepseek-chat',
      baseURL: baseURL || 'https://api.deepseek.com',
      isConfigured: !!apiKey,
      theme: theme || 'system',
      ollama: ollama || { baseURL: 'http://localhost:11434', modelName: 'qwen2.5:7b', enabled: false }
    })
  },

  setApiKey: async (key) => {
    await window.aeromind.settings.set('apiKey', key)
    set({ apiKey: key, isConfigured: !!key })
  },

  setShowSettings: (show) => set({ showSettings: show }),

  setTheme: async (theme) => {
    await window.aeromind.settings.set('theme', theme)
    set({ theme })
  },

  setOllama: async (config) => {
    await window.aeromind.ollama.save(config)
    set((state) => ({ ollama: { ...state.ollama, ...config } }))
  },

  updateSettings: (settings) => set(settings)
}))
