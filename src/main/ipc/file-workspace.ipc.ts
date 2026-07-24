import { ipcMain, dialog, BrowserWindow } from 'electron'

// 文件工作空间：用户选择一个文件夹作为 agent 文件读写工具的合法根目录
// 与 workspace.ipc.ts 的"项目工作区"(per-SQLite-DB) 语义不同，这里仅是文件系统目录白名单
export function registerFileWorkspaceIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle('fileWorkspace:pickFolder', async (): Promise<string | null> => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择工作空间文件夹',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })
}
