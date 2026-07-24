import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { exportToWord } from '../exporters/word.exporter'
import { exportToPDF } from '../exporters/pdf.exporter'
import type { ExportMessage, ExportOptions } from '../exporters'

function getDefaultFileName(format: string): string {
  const date = new Date().toISOString().slice(0, 10)
  const extensions: Record<string, string> = {
    word: 'docx',
    pdf: 'pdf',
    markdown: 'md'
  }
  return `LINZ_对话_${date}.${extensions[format] || format}`
}

function getFilters(format: string): Electron.FileFilter[] {
  switch (format) {
    case 'word':
      return [{ name: 'Word 文档', extensions: ['docx'] }]
    case 'pdf':
      return [{ name: 'PDF 文件', extensions: ['pdf'] }]
    case 'markdown':
      return [{ name: 'Markdown 文件', extensions: ['md'] }]
    default:
      return [{ name: '所有文件', extensions: ['*'] }]
  }
}

export function registerExportIPC(_mainWindow: BrowserWindow): void {
  ipcMain.handle(
    'export:saveDialog',
    async (_event, options: { format: string; defaultPath?: string }) => {
      const result = await dialog.showSaveDialog({
        title: '选择保存位置',
        defaultPath: options.defaultPath || getDefaultFileName(options.format),
        filters: getFilters(options.format)
      })
      if (result.canceled) return null
      return result.filePath
    }
  )

  ipcMain.handle(
    'export:word',
    async (_event, messages: ExportMessage[], options?: ExportOptions) => {
      const buffer = await exportToWord(messages, options)
      return buffer.toString('base64')
    }
  )

  ipcMain.handle(
    'export:pdf',
    async (_event, messages: ExportMessage[], options?: ExportOptions) => {
      const buffer = await exportToPDF(messages, options)
      return buffer.toString('base64')
    }
  )

  ipcMain.handle(
    'export:saveFile',
    async (_event, filePath: string, dataBase64: string) => {
      const buffer = Buffer.from(dataBase64, 'base64')
      fs.writeFileSync(filePath, buffer)
      return { success: true, filePath }
    }
  )
}
