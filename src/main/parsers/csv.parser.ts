import fs from 'fs'
import path from 'path'

const MAX_ROWS = 1000

export function detectDelimiter(line: string): string {
  const counts: Record<string, number> = { ',': 0, '\t': 0, ';': 0, '|': 0 }
  for (const ch of line) {
    if (ch in counts) counts[ch]++
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]
}

export function decodeBuffer(buffer: Buffer): string {
  // Try UTF-8 first
  const utf8 = buffer.toString('utf-8')
  // Check for BOM
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return utf8
  }
  // Heuristic: if no replacement chars, treat as valid UTF-8
  if (!utf8.includes('�')) {
    return utf8
  }
  // Fallback: try GBK via TextDecoder if available
  try {
    const decoder = new TextDecoder('gbk')
    return decoder.decode(buffer)
  } catch {
    return utf8
  }
}

function parseCsvContent(text: string): string[][] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0)
  if (lines.length === 0) return []

  const delimiter = detectDelimiter(lines[0])
  const rows: string[][] = []

  for (const line of lines) {
    const cells = line.split(delimiter).map((c) => c.trim().replace(/^"(.*)"$/, '$1'))
    rows.push(cells)
  }

  return rows
}

function rowsToMarkdownTable(rows: string[][]): string {
  if (rows.length === 0) return ''

  const maxCols = Math.max(...rows.map((r) => r.length))
  const header = rows[0]
  const headerLine = '| ' + Array.from({ length: maxCols }, (_, i) => header[i] ?? '').join(' | ') + ' |'
  const separator = '| ' + Array.from({ length: maxCols }, () => '---').join(' | ') + ' |'
  const bodyLines = rows.slice(1, MAX_ROWS).map(
    (row) => '| ' + Array.from({ length: maxCols }, (_, i) => String(row[i] ?? '')).join(' | ') + ' |'
  )

  const parts = [headerLine, separator, ...bodyLines]
  if (rows.length > MAX_ROWS) {
    parts.push(`\n(已截断，共 ${rows.length} 行，仅显示前 ${MAX_ROWS} 行)`)
  }
  return parts.join('\n')
}

export async function parseCsv(filePath: string): Promise<{ content: string; rows?: number }> {
  const ext = path.extname(filePath).toLowerCase()
  const buffer = fs.readFileSync(filePath)

  if (buffer.length === 0) {
    return { content: '', rows: 0 }
  }

  const text = decodeBuffer(buffer)
  const rows = parseCsvContent(text)
  const content = rowsToMarkdownTable(rows)

  return {
    content,
    rows: rows.length
  }
}

export { parseCsv as parseDat }
