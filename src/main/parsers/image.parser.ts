import path from 'path'
import fs from 'fs'

// tesseract.js WASM 与 Electron 主进程不兼容，图片解析暂返回元数据信息
// 未来可通过 BrowserWindow 渲染进程执行 OCR 或集成外部 OCR 服务

export async function parseImage(filePath: string): Promise<{ content: string; metadata: { width?: number; height?: number; size: number; confidence?: number } }> {
  const stats = fs.statSync(filePath)
  const fileName = path.basename(filePath)

  // 读取图片基本信息
  const size = stats.size
  let width: number | undefined
  let height: number | undefined

  try {
    const buffer = fs.readFileSync(filePath)
    const dims = getImageDimensions(buffer)
    if (dims) {
      width = dims.width
      height = dims.height
    }
  } catch {
    // 忽略维度读取失败
  }

  const dimInfo = width && height ? `${width}x${height}` : '未知尺寸'
  const sizeKB = Math.round(size / 1024)

  return {
    content: `[图片: ${fileName}] 尺寸: ${dimInfo}, 大小: ${sizeKB}KB。OCR 文字识别暂不可用，如需提取图片中的文字内容，建议先将图片中的文字手动录入文档后上传。`,
    metadata: {
      width,
      height,
      size
    }
  }
}

// 从图片文件头读取宽高（支持 PNG/JPEG）
function getImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  // PNG: 宽高在 IHDR chunk (offset 16)
  if (buffer[0] === 0x89 && buffer[1] === 0x50) {
    return {
      width: buffer.readUInt32BE(16),
      height: buffer.readUInt32BE(20)
    }
  }
  // JPEG: 查找 SOF0 marker
  if (buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2
    while (offset < buffer.length - 1) {
      if (buffer[offset] !== 0xFF) break
      const marker = buffer[offset + 1]
      // SOF0 (0xFFC0) or SOF2 (0xFFC2)
      if (marker === 0xC0 || marker === 0xC2) {
        return {
          height: buffer.readUInt16BE(offset + 5),
          width: buffer.readUInt16BE(offset + 7)
        }
      }
      const segLen = buffer.readUInt16BE(offset + 2)
      offset += 2 + segLen
    }
  }
  return null
}
