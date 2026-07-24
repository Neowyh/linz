import fs from 'fs'
import mammoth from 'mammoth'

export async function parseDocx(filePath: string): Promise<{ content: string }> {
  const buffer = fs.readFileSync(filePath)

  if (buffer.length === 0) {
    return { content: '' }
  }

  const result = await mammoth.extractRawText({ buffer })
  return {
    content: result.value || ''
  }
}
