import { create } from 'zustand'

interface OllamaState {
  baseURL: string
  modelName: string
  enabled: boolean
}

export type BackgroundFit = 'cover' | 'contain' | 'center' | 'repeat'

interface SettingsState {
  apiKey: string
  modelProvider: string
  modelName: string
  baseURL: string
  isConfigured: boolean
  showSettings: boolean
  theme: 'light' | 'dark' | 'system'
  ollama: OllamaState
  // 自定义背景：dataUrl 仅在内存中持有（启动/更换时读取一次），路径持久化在主进程
  backgroundDataUrl: string | null
  backgroundFileName: string | null
  backgroundFit: BackgroundFit
  backgroundOpacity: number

  loadSettings: () => Promise<void>
  setApiKey: (key: string) => Promise<void>
  setShowSettings: (show: boolean) => void
  setTheme: (theme: 'light' | 'dark' | 'system') => Promise<void>
  setOllama: (config: Partial<OllamaState>) => Promise<void>
  updateSettings: (settings: Partial<SettingsState>) => void
  loadBackground: () => Promise<void>
  pickBackground: () => Promise<{ ok: boolean; error?: string }>
  clearBackground: () => Promise<void>
  setBackgroundFit: (fit: BackgroundFit) => Promise<void>
  setBackgroundOpacity: (opacity: number) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
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
  backgroundDataUrl: null,
  backgroundFileName: null,
  backgroundFit: 'cover',
  backgroundOpacity: 0.85,

  loadSettings: async () => {
    const [apiKey, modelProvider, modelName, baseURL, theme, ollama] = await Promise.all([
      window.aeromind.settings.getApiKey(),
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
    // 异步加载背景图（不阻塞核心设置加载）
    void get().loadBackground()
  },

  setApiKey: async (key) => {
    await window.aeromind.settings.setApiKey(key)
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

  updateSettings: (settings) => set(settings),

  loadBackground: async () => {
    const [img, fit, opacity] = await Promise.all([
      window.aeromind.background.getImage(),
      window.aeromind.settings.get('backgroundFit'),
      window.aeromind.settings.get('backgroundOpacity')
    ])
    set({
      backgroundDataUrl: img?.dataUrl ?? null,
      backgroundFileName: img?.fileName ?? null,
      backgroundFit: (fit as BackgroundFit) || 'cover',
      backgroundOpacity: typeof opacity === 'number' ? opacity : 0.85
    })
  },

  pickBackground: async () => {
    const result = await window.aeromind.background.pickImage()
    if (!result) return { ok: false, error: '未选择图片' }
    if ('error' in result) return { ok: false, error: result.error }
    set({ backgroundDataUrl: result.dataUrl, backgroundFileName: result.fileName })
    return { ok: true }
  },

  clearBackground: async () => {
    await window.aeromind.background.clearImage()
    set({ backgroundDataUrl: null, backgroundFileName: null })
  },

  setBackgroundFit: async (fit) => {
    await window.aeromind.settings.set('backgroundFit', fit)
    set({ backgroundFit: fit })
  },

  setBackgroundOpacity: async (opacity) => {
    await window.aeromind.settings.set('backgroundOpacity', opacity)
    set({ backgroundOpacity: opacity })
  }
}))
