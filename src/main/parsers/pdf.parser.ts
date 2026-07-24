import fs from 'fs'

export async function parsePdf(filePath: string): Promise<{ content: string; pages?: number }> {
  // 使用 require 而非 import，确保 electron-vite externalizeDepsPlugin 正确转换为绝对路径
  const pdfParse = require('pdf-parse')
  const buffer = fs.readFileSync(filePath)

  if (buffer.length === 0) {
    return { content: '', pages: 0 }
  }

  const data = await pdfParse(buffer)
  return {
    content: data.text || '',
    pages: data.numpages
  }
}
