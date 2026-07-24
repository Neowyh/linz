import fs from 'fs'
import XLSX from 'xlsx'

const MAX_ROWS = 1000

export async function parseXlsx(filePath: string): Promise<{ content: string; sheets?: string[]; rows?: number }> {
  const buffer = fs.readFileSync(filePath)

  if (buffer.length === 0) {
    return { content: '', sheets: [], rows: 0 }
  }

  const workbook = XLSX.read(buffer, { type: 'buffer' })
  const sheetNames = workbook.SheetNames
  const parts: string[] = []
  let totalRows = 0

  for (const name of sheetNames) {
    const sheet = workbook.Sheets[name]
    const jsonData: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' })

    if (jsonData.length === 0) continue

    const truncated = jsonData.slice(0, MAX_ROWS)
    totalRows += truncated.length

    if (sheetNames.length > 1) {
      parts.push(`## Sheet: ${name}`)
    }

    // Convert to markdown table
    if (truncated.length > 0) {
      const maxCols = Math.max(...truncated.map((r) => r.length))
      const header = truncated[0]
      const headerLine = '| ' + Array.from({ length: maxCols }, (_, i) => header[i] ?? '').join(' | ') + ' |'
      const separator = '| ' + Array.from({ length: maxCols }, () => '---').join(' | ') + ' |'
      const bodyLines = truncated.slice(1).map(
        (row) => '| ' + Array.from({ length: maxCols }, (_, i) => String(row[i] ?? '')).join(' | ') + ' |'
      )
      parts.push(headerLine, separator, ...bodyLines)
    }

    if (jsonData.length > MAX_ROWS) {
      parts.push(`\n(已截断，共 ${jsonData.length} 行，仅显示前 ${MAX_ROWS} 行)`)
    }
  }

  return {
    content: parts.join('\n'),
    sheets: sheetNames,
    rows: totalRows
  }
}
