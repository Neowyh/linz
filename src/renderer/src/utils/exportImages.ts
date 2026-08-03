// 导出前图片预处理：
// 1. svgToPngDataUrl — SVG data URL 转 PNG data URL（canvas 光栅化，docx 不支持 SVG）
// 2. convertContentSvgToPng — Word 导出用：content 内全部 SVG 转 PNG 并保持内联
// 3. extractImagesToFiles — Markdown 导出用：抽取全部图片为文件，替换为相对路径引用

const IMG_MARKDOWN_RE = /!\[([^\]]*)\]\((data:image\/(?:svg\+xml|png|jpeg|jpg|gif);base64,[A-Za-z0-9+/=]+)\)/g

// SVG data URL → PNG data URL（失败返回原样，由调用方兜底）
export function svgToPngDataUrl(dataUrl: string): Promise<string> {
  return new Promise((resolve) => {
    try {
      const img = new Image()
      img.onload = () => {
        try {
          const w = img.naturalWidth || 720
          const h = img.naturalHeight || 420
          if (w <= 0 || h <= 0 || w > 4096 || h > 4096) {
            resolve(dataUrl)
            return
          }
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) {
            resolve(dataUrl)
            return
          }
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(0, 0, w, h)
          ctx.drawImage(img, 0, 0, w, h)
          const png = canvas.toDataURL('image/png')
          resolve(png.startsWith('data:image/png') ? png : dataUrl)
        } catch {
          resolve(dataUrl)
        }
      }
      img.onerror = () => resolve(dataUrl)
      img.src = dataUrl
    } catch {
      resolve(dataUrl)
    }
  })
}

// Word 导出用：content 中所有 SVG data URL 转为 PNG data URL（保持内联）
export async function convertContentSvgToPng(content: string): Promise<string> {
  const matches = Array.from(content.matchAll(IMG_MARKDOWN_RE))
  if (matches.length === 0) return content
  let out = content
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    const dataUrl = m[2]
    if (!dataUrl.startsWith('data:image/svg+xml')) continue
    const png = await svgToPngDataUrl(dataUrl)
    if (png === dataUrl) continue
    const full = `![${m[1]}](${dataUrl})`
    out = out.slice(0, m.index) + `![${m[1]}](${png})` + out.slice(m.index + full.length)
  }
  return out
}

// 抽取 content 中所有图片：SVG 先转 PNG，返回替换引用后的 content 与图片文件列表
export interface ExtractedImage {
  name: string
  base64: string
}

export async function extractImagesToFiles(
  content: string,
  namePrefix = 'chart'
): Promise<{ content: string; images: ExtractedImage[] }> {
  const images: ExtractedImage[] = []
  const matches = Array.from(content.matchAll(IMG_MARKDOWN_RE))
  let out = content

  // 逆序替换，避免索引偏移
  for (let i = matches.length - 1; i >= 0; i--) {
    const m = matches[i]
    const alt = m[1] || '图表'
    const dataUrl = m[2]
    const converted = dataUrl.startsWith('data:image/svg+xml') ? await svgToPngDataUrl(dataUrl) : dataUrl
    if (!converted.startsWith('data:image/')) continue
    const b64 = converted.slice(converted.indexOf('base64,') + 7)
    if (!b64) continue
    const ext = converted.startsWith('data:image/png') ? 'png' : converted.startsWith('data:image/jpeg') ? 'jpg' : 'gif'
    const name = `${namePrefix}_${i + 1}.${ext}`
    images.unshift({ name, base64: b64 })
    const full = `![${alt}](${dataUrl})`
    out = out.slice(0, m.index) + `![${alt}](images/${name})` + out.slice(m.index + full.length)
  }

  return { content: out, images }
}
