import { ipcMain, app, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { getAppConfig } from '../store/app-config'

// 自定义背景支持的图片类型（与 file-browser 预览一致，去掉 svg/ico——不适合做桌面壁纸）
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp'
}

// 背景图大小上限：10MB（data-URL 在渲染层内存中持有，过大会拖慢渲染）
const MAX_BG_BYTES = 10 * 1024 * 1024

/** userData 下的背景图片存放目录 */
function getBackgroundDir(): string {
  return path.join(app.getPath('userData'), 'backgrounds')
}

/** 读取磁盘图片并构造 data-URL；不存在或不可读时返回 null */
function readAsDataUrl(filePath: string): { dataUrl: string; fileName: string } | null {
  try {
    const stat = fs.statSync(filePath)
    if (!stat.isFile()) return null
    if (stat.size > MAX_BG_BYTES) return null
    const ext = path.extname(filePath).toLowerCase()
    const mime = IMAGE_MIME[ext]
    if (!mime) return null
    const b64 = fs.readFileSync(filePath).toString('base64')
    return { dataUrl: `data:${mime};base64,${b64}`, fileName: path.basename(filePath) }
  } catch {
    return null
  }
}

export function registerBackgroundIPC(mainWindow: BrowserWindow): void {
  // 选择图片：弹出系统文件对话框 → 复制到 userData/backgrounds/ → 持久化路径 → 返回 data-URL
  ipcMain.handle('background:pickImage', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择背景图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const src = result.filePaths[0]
    const ext = path.extname(src).toLowerCase()
    if (!IMAGE_MIME[ext]) {
      return { error: '不支持的图片格式，请选择 png/jpg/jpeg/gif/webp/bmp' }
    }

    // 校验源文件大小
    try {
      if (fs.statSync(src).size > MAX_BG_BYTES) {
        return { error: '图片过大（超过 10MB），请选择更小的图片' }
      }
    } catch {
      return { error: '无法读取所选文件' }
    }

    const dir = getBackgroundDir()
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    // 若已有旧背景文件，先删除（处理扩展名变更等场景，避免残留）
    const config = getAppConfig()
    const oldPath = (config.get('backgroundImage') as string) || ''
    if (oldPath && oldPath !== src) {
      try {
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath)
      } catch {
        // 忽略：旧文件可能已不存在
      }
    }

    const dest = path.join(dir, `custom-bg${ext}`)
    try {
      fs.copyFileSync(src, dest)
    } catch {
      return { error: '保存背景图片失败' }
    }

    config.set('backgroundImage', dest)
    const out = readAsDataUrl(dest)
    if (!out) return { error: '读取背景图片失败' }
    return out
  })

  // 读取已保存的背景图片（启动时调用，返回内存中的 data-URL）
  ipcMain.handle('background:getImage', async () => {
    const config = getAppConfig()
    const saved = (config.get('backgroundImage') as string) || ''
    if (!saved) return null
    if (!fs.existsSync(saved)) return null
    return readAsDataUrl(saved)
  })

  // 清除背景：删除磁盘文件 + 清空配置
  ipcMain.handle('background:clearImage', async () => {
    const config = getAppConfig()
    const saved = (config.get('backgroundImage') as string) || ''
    if (saved) {
      try {
        if (fs.existsSync(saved)) fs.unlinkSync(saved)
      } catch {
        // 忽略删除失败
      }
    }
    config.set('backgroundImage', '')
    return { success: true }
  })
}
