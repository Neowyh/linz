import { ipcMain } from 'electron'
import { getAppConfig } from '../store/app-config'

export function registerSettingsIPC(): void {
  ipcMain.handle('settings:get', async (_event, key: string) => {
    const config = getAppConfig()
    return config.get(key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: any) => {
    const config = getAppConfig()
    config.set(key, value)
    return { success: true }
  })
}
