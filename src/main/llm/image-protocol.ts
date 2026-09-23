// 工具图片输出协议：工具可在返回文本中嵌入 <<<IMAGE>>>...<<<\/IMAGE>>> 块，
// 块内容为 data URL（如 data:image/svg+xml;base64,...）。
// stream-handler 提取后转为 markdown 图片直接进入对话流；块本身不回传 LLM，
// 避免 base64 撑爆上下文。

export const IMAGE_BLOCK_START = '<<<IMAGE>>>'
export const IMAGE_BLOCK_END = '<<</IMAGE>>>'

export const IMAGE_BLOCK_RE = /<<<IMAGE>>>\s*([\s\S]*?)\s*<<<\/IMAGE>>>/g

// 从工具输出中提取全部图片块，返回去除块后的纯文本与图片 data URL 列表
export function extractImageBlocks(text: string): { cleanText: string; images: string[] } {
  const images: string[] = []
  const cleanText = text.replace(IMAGE_BLOCK_RE, (_m, img: string) => {
    const trimmed = img.trim()
    if (trimmed) images.push(trimmed)
    return ''
  })
  return { cleanText: cleanText.trim(), images }
}

// markdown 图片中的 data URL（base64）：![alt](data:image/png;base64,...)
const MARKDOWN_DATA_URL_IMAGE_RE = /!\[[^\]]*\]\(data:image\/[^)]+\)/g
// 裸 data URL（未包裹在 markdown 图片语法中）
const BARE_DATA_URL_RE = /data:image\/[a-z+.-]+;base64,[A-Za-z0-9+/=]+/g

// 剥离文本中的 data URL 图片，替换为占位标记。
// 用于持久化与历史重建，避免数 MB 的 base64 写入 DB 或回传 LLM 撑爆上下文。
// 图片本身已在对话流中展示给用户，历史中只需保留文字指代。
export function stripDataUrlImages(text: string): string {
  if (!text) return text
  return text
    .replace(MARKDOWN_DATA_URL_IMAGE_RE, '[图片]')
    .replace(BARE_DATA_URL_RE, '[图片]')
}
