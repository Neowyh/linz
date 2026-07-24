import { ipcMain } from 'electron'
import { isOllamaAvailable, getActiveModelStatus } from '../llm'
import { getAppConfig } from '../store/app-config'

export function registerOllamaIPC(): void {
  ipcMain.handle('ollama:check', async () => {
    return await isOllamaAvailable()
  })

  ipcMain.handle('ollama:status', async () => {
    return getActiveModelStatus()
  })

  ipcMain.handle('ollama:save', async (_event, config: { baseURL?: string; modelName?: string; enabled?: boolean }) => {
    const store = getAppConfig()
    const current = store.get('ollama')
    store.set('ollama', { ...current, ...config })
    return { success: true }
  })
}
