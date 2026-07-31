import fs from 'fs'
import path from 'path'
import XLSX from 'xlsx'
import { v4 as uuidv4 } from 'uuid'
import * as tables from '../database/tables'
import { decodeBuffer, detectDelimiter } from '../parsers/csv.parser'

// 表格文件导入：xlsx/xls/csv/tsv/txt → tables.db 真实 SQLite 表
// 首行作表头；同名数据集重复导入 = 替换；主进程内解析（数据量级秒级完成，无需 worker）

const MAX_ROWS_PER_TABLE = 500_000

export interface TableImportResult {
  fileName: string
  status: 'done' | 'error'
  error?: string
  datasetId?: string
  datasetName?: string
  tableCount?: number
  totalRows?: number
}

interface SheetData {
  sheetName: string | null
  rows: unknown[][]
}

function parseDelimitedText(text: string, forcedDelimiter?: string): unknown[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []
  const delimiter = forcedDelimiter ?? detectDelimiter(lines[0])
  return lines.map((line) => line.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1')))
}

function isEmptyRow(row: unknown[]): boolean {
  return row.every((c) => String(c ?? '').trim() === '')
}

function readSheets(filePath: string, ext: string): SheetData[] {
  if (ext === '.xlsx' || ext === '.xls') {
    const workbook = XLSX.read(fs.readFileSync(filePath), { type: 'buffer' })
    const sheets: SheetData[] = []
    for (const name of workbook.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' }) as unknown[][]
      if (rows.length > 0) sheets.push({ sheetName: name, rows })
    }
    return sheets
  }
  const text = decodeBuffer(fs.readFileSync(filePath))
  const rows = parseDelimitedText(text, ext === '.tsv' ? '\t' : undefined)
  return rows.length > 0 ? [{ sheetName: null, rows }] : []
}

export function importTableFile(filePath: string): TableImportResult {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)
  const datasetName = path.basename(filePath, ext)
  let datasetId: string | null = null

  try {
    const sheets = readSheets(filePath, ext)
    if (sheets.length === 0) {
      throw new Error('未提取到表格数据（文件为空或无有效 sheet）')
    }

    // 同名数据集 → 替换（删除旧表）
    const existing = tables.findDatasetByName(datasetName)
    if (existing) tables.deleteDataset(existing.id)

    datasetId = uuidv4()
    tables.insertDataset({ id: datasetId, name: datasetName, sourceFile: filePath, fileType: ext.replace('.', '') })

    let totalRows = 0
    for (const sheet of sheets) {
      const [header, ...bodyRows] = sheet.rows
      const headers = tables.sanitizeColumnNames(header as unknown[])
      let dataRows = bodyRows.filter((r) => !isEmptyRow(r))
      if (dataRows.length === 0) continue
      if (dataRows.length > MAX_ROWS_PER_TABLE) {
        dataRows = dataRows.slice(0, MAX_ROWS_PER_TABLE)
      }
      const columns = tables.inferColumns(headers, dataRows)
      const baseName = sheet.sheetName ? `${datasetName}_${sheet.sheetName}` : datasetName
      const tableName = tables.sanitizeTableName(baseName)
      tables.createDataTable({
        id: uuidv4(),
        datasetId,
        tableName,
        sheetName: sheet.sheetName,
        columns,
        rows: dataRows
      })
      totalRows += dataRows.length
    }

    if (totalRows === 0) {
      throw new Error('所有 sheet 均无数据行')
    }

    const dataset = tables.findDatasetByName(datasetName)
    return {
      fileName,
      status: 'done',
      datasetId,
      datasetName,
      tableCount: dataset?.table_count ?? 0,
      totalRows
    }
  } catch (err: any) {
    // 已部分写入时整体清理，避免半成品数据集
    if (datasetId) {
      try {
        tables.deleteDataset(datasetId)
      } catch {
        // ignore
      }
    }
    return { fileName, status: 'error', error: err.message || String(err) }
  }
}
