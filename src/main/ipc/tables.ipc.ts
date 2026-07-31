import { ipcMain, dialog, BrowserWindow } from 'electron'
import * as tables from '../database/tables'
import { importTableFile, type TableImportResult } from '../tables/import'

// 表格数据库 IPC：文档库"数据库"Tab 的导入/列表/预览/删除/试查

export function registerTablesIPC(mainWindow: BrowserWindow): void {
  // 数据集列表（含每个数据集的表结构）
  ipcMain.handle('tables:list', async () => {
    return tables.listDatasets().map((d) => ({
      ...d,
      tables: tables.listTables(d.id)
    }))
  })

  // 文件对话框导入（多选），同名数据集替换
  ipcMain.handle('tables:import', async (): Promise<TableImportResult[]> => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '表格文件', extensions: ['xlsx', 'xls', 'csv', 'tsv', 'txt'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return []
    return result.filePaths.map((p) => importTableFile(p))
  })

  // 预览某张表前 N 行
  ipcMain.handle('tables:preview', async (_event, tableName: string, limit?: number) => {
    try {
      return { success: true, ...tables.previewRows(tableName, limit || 20) }
    } catch (err: any) {
      return { success: false, error: err.message || String(err), columns: [], rows: [], truncated: false }
    }
  })

  // 删除数据集（连带 DROP 真实表）
  ipcMain.handle('tables:remove', async (_event, datasetId: string) => {
    try {
      tables.deleteDataset(datasetId)
      return { success: true }
    } catch (err: any) {
      return { success: false, error: err.message || String(err) }
    }
  })

  // 手动试查（与 db_query 工具同一入口）
  ipcMain.handle('tables:query', async (_event, sql: string) => {
    try {
      return { success: true, ...tables.runReadOnlyQuery(sql) }
    } catch (err: any) {
      return { success: false, error: err.message || String(err), columns: [], rows: [], truncated: false }
    }
  })
}
