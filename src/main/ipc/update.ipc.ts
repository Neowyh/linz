import { ipcMain, app, dialog, type BrowserWindow } from 'electron'
import {
  checkForUpdates,
  downloadUpdate,
  markPending,
  getCurrentVersion,
  formatBytes
} from '../updater/update-checker'
import type { UpdateInfo, UpdateStatus, DownloadProgress } from '../updater/types'

let currentStatus: UpdateStatus = 'idle'
let currentUpdateInfo: UpdateInfo | null = null

export function registerUpdateIPC(mainWindow: BrowserWindow): void {
  // ── 检查更新 ────────────────────────────────────────────
  ipcMain.handle('update:check', async () => {
    currentStatus = 'checking'
    try {
      const { getAppConfig } = await import('../store/app-config')
      const serverUrl = getAppConfig().get('updateServerUrl') as string
      if (!serverUrl) {
        currentStatus = 'idle'
        return { available: false, error: '未配置更新服务器地址' }
      }

      const info = await checkForUpdates(serverUrl)
      currentUpdateInfo = info
      currentStatus = info ? 'idle' : 'idle'

      if (info) {
        // 通知渲染进程有可用更新
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:available', {
            currentVersion: info.currentVersion,
            latestVersion: info.latestVersion,
            totalDownloadSize: info.totalDownloadSize,
            totalDownloadSizeFormatted: formatBytes(info.totalDownloadSize),
            fileCount: info.files.length,
            changelog: info.changelog
          })
        }
      }

      return info
        ? { available: true, ...info, totalDownloadSizeFormatted: formatBytes(info.totalDownloadSize) }
        : { available: false }
    } catch (err) {
      currentStatus = 'error'
      console.error('[Updater] Check failed:', err)
      return { available: false, error: String(err) }
    }
  })

  // ── 下载更新 ────────────────────────────────────────────
  ipcMain.handle('update:download', async () => {
    if (!currentUpdateInfo) {
      return { success: false, error: '没有待下载的更新' }
    }

    currentStatus = 'downloading'
    try {
      const { getAppConfig } = await import('../store/app-config')
      const serverUrl = getAppConfig().get('updateServerUrl') as string

      await downloadUpdate(serverUrl, currentUpdateInfo, (progress: DownloadProgress) => {
        if (!mainWindow.isDestroyed()) {
          mainWindow.webContents.send('update:downloadProgress', {
            fileName: progress.fileName,
            downloaded: progress.downloaded,
            total: progress.total,
            fileIndex: progress.fileIndex,
            fileCount: progress.fileCount,
            totalDownloaded: progress.totalDownloaded,
            totalSize: progress.totalSize,
            percent: progress.totalSize > 0
              ? Math.round((progress.totalDownloaded / progress.totalSize) * 100)
              : 0
          })
        }
      })

      // 下载完成，标记 pending
      markPending(currentUpdateInfo)
      currentStatus = 'ready'

      if (!mainWindow.isDestroyed()) {
        mainWindow.webContents.send('update:downloadComplete', {
          version: currentUpdateInfo.latestVersion
        })
      }

      return { success: true }
    } catch (err) {
      currentStatus = 'error'
      console.error('[Updater] Download failed:', err)
      return { success: false, error: String(err) }
    }
  })

  // ── 应用并重启 ──────────────────────────────────────────
  ipcMain.handle('update:applyAndRestart', async () => {
    // pending.json 已在 download 时写入，重启时由 patch-applier 应用
    console.log('[Updater] Relaunching to apply update...')
    app.relaunch()
    app.quit()
    return { success: true }
  })

  // ── 获取当前状态 ────────────────────────────────────────
  ipcMain.handle('update:getStatus', async () => {
    return {
      status: currentStatus,
      currentVersion: getCurrentVersion(),
      hasUpdate: !!currentUpdateInfo,
      updateInfo: currentUpdateInfo
        ? {
            latestVersion: currentUpdateInfo.latestVersion,
            totalDownloadSize: currentUpdateInfo.totalDownloadSize,
            totalDownloadSizeFormatted: formatBytes(currentUpdateInfo.totalDownloadSize),
            fileCount: currentUpdateInfo.files.length,
            changelog: currentUpdateInfo.changelog
          }
        : null
    }
  })

  // ── 获取当前版本号 ───────────────────────────────────────
  ipcMain.handle('update:getCurrentVersion', async () => {
    return getCurrentVersion()
  })

  // ── 选择离线补丁包文件 ──────────────────────────────────
  ipcMain.handle('update:pickPatchFile', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择补丁包',
      properties: ['openFile'],
      filters: [
        { name: 'LINZ 补丁包', extensions: ['linzpatch', 'zip'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  // ── 应用离线补丁包 ──────────────────────────────────────
  ipcMain.handle('update:applyOfflinePatch', async (_event, zipPath: string) => {
    try {
      const { validatePatchZip, extractPatchZip } = await import('../updater/offline-patch')
      const validation = validatePatchZip(zipPath)
      if (!validation.valid) {
        return { success: false, error: validation.error }
      }
      const result = await extractPatchZip(zipPath)
      if (!result.success) return result
      return {
        success: true,
        needsRestart: true,
        fromVersion: validation.manifest.fromVersion,
        toVersion: validation.manifest.toVersion
      }
    } catch (err) {
      console.error('[Updater] Offline patch failed:', err)
      return { success: false, error: String(err) }
    }
  })
}
