import path from 'path'
import fs from 'fs'
import { parsePdf } from './pdf.parser'
import { parseDocx } from './docx.parser'
import { parseXlsx } from './xlsx.parser'
import { parseCsv, parseDat } from './csv.parser'
import { parseImage } from './image.parser'

export interface ParsedAttachment {
  fileName: string
  fileType: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'dat' | 'txt' | 'png' | 'jpg' | 'unknown'
  content: string
  metadata?: {
    pages?: number
    sheets?: string[]
    rows?: number
    confidence?: number
  }
  error?: string
}

const MAX_CONTENT_LENGTH = 50000

function getFileType(filePath: string): ParsedAttachment['fileType'] {
  const ext = path.extname(filePath).toLowerCase().replace('.', '')
  // Normalize jpg variants
  if (ext === 'jpeg') return 'jpg'
  const supported: ParsedAttachment['fileType'][] = ['pdf', 'docx', 'xlsx', 'csv', 'dat', 'txt', 'png', 'jpg']
  return supported.includes(ext as ParsedAttachment['fileType']) ? (ext as ParsedAttachment['fileType']) : 'unknown'
}

export async function parseFile(filePath: string): Promise<ParsedAttachment> {
  const fileName = path.basename(filePath)
  const fileType = getFileType(filePath)

  if (fileType === 'unknown') {
    // Try reading as plain text for unknown extensions
    try {
      const buffer = fs.readFileSync(filePath)
      const text = buffer.toString('utf-8')
      if (!text.includes('�')) {
        return {
          fileName,
          fileType: 'txt',
          content: text.substring(0, MAX_CONTENT_LENGTH)
        }
      }
    } catch {}
    return {
      fileName,
      fileType: 'unknown',
      content: '',
      error: `不支持的文件类型: ${path.extname(filePath)}`
    }
  }

  try {
    const stats = fs.statSync(filePath)
    if (stats.size > 50 * 1024 * 1024) {
      return {
        fileName,
        fileType,
        content: '',
        error: '文件过大（超过50MB），无法解析'
      }
    }

    let result: { content: string; metadata?: ParsedAttachment['metadata'] }

    switch (fileType) {
      case 'pdf': {
        const r = await parsePdf(filePath)
        result = { content: r.content, metadata: { pages: r.pages } }
        break
      }
      case 'docx': {
        const r = await parseDocx(filePath)
        result = { content: r.content }
        break
      }
      case 'xlsx': {
        const r = await parseXlsx(filePath)
        result = { content: r.content, metadata: { sheets: r.sheets, rows: r.rows } }
        break
      }
      case 'csv': {
        const r = await parseCsv(filePath)
        result = { content: r.content, metadata: { rows: r.rows } }
        break
      }
      case 'dat': {
        const r = await parseDat(filePath)
        result = { content: r.content, metadata: { rows: r.rows } }
        break
      }
      case 'txt': {
        const buffer = fs.readFileSync(filePath)
        result = { content: buffer.toString('utf-8') }
        break
      }
      case 'png':
      case 'jpg': {
        const r = await parseImage(filePath)
        result = { content: r.content, metadata: { confidence: r.metadata.confidence } }
        break
      }
      default:
        result = { content: '' }
    }

    // Truncate if too long
    if (result.content.length > MAX_CONTENT_LENGTH) {
      result.content = result.content.substring(0, MAX_CONTENT_LENGTH) + '\n\n...(内容过长已截断)'
    }

    return {
      fileName,
      fileType,
      content: result.content,
      metadata: result.metadata
    }
  } catch (err: any) {
    return {
      fileName,
      fileType,
      content: '',
      error: `文件解析失败: ${err.message || '未知错误'}`
    }
  }
}

export function formatAttachmentContent(parsed: ParsedAttachment): string {
  if (parsed.error) {
    return `[附件: ${parsed.fileName}]\n解析失败: ${parsed.error}\n`
  }

  const metaParts: string[] = []
  if (parsed.metadata?.pages) metaParts.push(`${parsed.metadata.pages}页`)
  if (parsed.metadata?.sheets) metaParts.push(`工作表: ${parsed.metadata.sheets.join(', ')}`)
  if (parsed.metadata?.rows) metaParts.push(`${parsed.metadata.rows}行`)
  if (parsed.metadata?.confidence !== undefined) metaParts.push(`OCR置信度: ${Math.round(parsed.metadata.confidence)}%`)

  const metaLine = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : ''

  return [
    `[附件: ${parsed.fileName}${metaLine}]`,
    '---文件内容开始---',
    parsed.content || '(文件内容为空)',
    '---文件内容结束---'
  ].join('\n')
}
