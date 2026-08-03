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
