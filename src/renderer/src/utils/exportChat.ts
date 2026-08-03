import { message } from 'antd'
import type { ChatMessage } from '../types/chat'
import { extractImagesToFiles, convertContentSvgToPng } from './exportImages'
import { resolveAgentDisplaySnapshot } from './agentDisplay'

// 导出对话为 Markdown（文件夹导出：.md + images/，图片以相对路径引用）
export async function exportConversationMarkdown(messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return

  let md = '# 临智 LINZ 对话导出\n\n'
  md += `导出时间: ${new Date().toLocaleString('zh-CN')}\n\n---\n\n`

  let allImages: Awaited<ReturnType<typeof extractImagesToFiles>>['images'] = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const { content, images } = await extractImagesToFiles(msg.content, `msg${i + 1}`)
    allImages = allImages.concat(images)
    if (msg.role === 'user') {
      md += `## 👤 用户\n\n${content}\n\n`
    } else {
      const agentLabel = msg.agentType ? `🤖 ${resolveAgentDisplaySnapshot(msg.agentType).name}` : '🤖 助手'
      md += `## ${agentLabel}\n\n${content}\n\n`
    }
  }

  const dirPath = await window.aeromind.export.saveDirectory()
  if (!dirPath) return
  await window.aeromind.export.saveMarkdownBundle({
    dirPath,
    fileName: `LINZ_${new Date().toISOString().slice(0, 10)}.md`,
    mdContent: md,
    images: allImages
  })
  message.success(allImages.length > 0 ? `对话已导出为 Markdown（含 ${allImages.length} 张图片）` : '对话已导出为 Markdown')
}

// 导出对话为 Word (.docx)
export async function exportConversationWord(messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return

  const filePath = await window.aeromind.export.saveDialog({
    format: 'word',
    defaultPath: `LINZ_对话_${new Date().toISOString().slice(0, 10)}.docx`
  })
  if (!filePath) return

  // SVG 转 PNG（docx 不支持 SVG），Word 导出器会把 PNG data URL 渲染为图片
  const contents = await Promise.all(messages.map((msg) => convertContentSvgToPng(msg.content)))
  const exportMessages = messages.map((msg, i) => ({
    id: msg.id,
    role: msg.role,
    agentType: msg.agentType,
    content: contents[i],
    createdAt: msg.createdAt
  }))

  const base64 = await window.aeromind.export.word(exportMessages, {
    includeAgentBadges: true,
    title: 'LINZ 对话记录'
  })
  await window.aeromind.export.saveFile(filePath, base64)
  message.success('对话已导出为 Word 文档')
}

// 导出对话为 PDF
export async function exportConversationPdf(messages: ChatMessage[]): Promise<void> {
  if (messages.length === 0) return

  const filePath = await window.aeromind.export.saveDialog({
    format: 'pdf',
    defaultPath: `LINZ_对话_${new Date().toISOString().slice(0, 10)}.pdf`
  })
  if (!filePath) return

  const exportMessages = messages.map((msg) => ({
    id: msg.id,
    role: msg.role,
    agentType: msg.agentType,
    content: msg.content,
    createdAt: msg.createdAt
  }))

  const base64 = await window.aeromind.export.pdf(exportMessages, {
    includeAgentBadges: true,
    title: 'LINZ 对话记录'
  })
  await window.aeromind.export.saveFile(filePath, base64)
  message.success('对话已导出为 PDF')
}

export type ExportFormat = 'markdown' | 'word' | 'pdf'

// 菜单导出入口：无消息时提示，有则按格式导出
export async function exportConversationByMenu(messages: ChatMessage[], format: ExportFormat): Promise<void> {
  if (messages.length === 0) {
    message.warning('当前没有可导出的对话内容')
    return
  }
  try {
    if (format === 'markdown') await exportConversationMarkdown(messages)
    else if (format === 'word') await exportConversationWord(messages)
    else await exportConversationPdf(messages)
  } catch (err: any) {
    message.error(`导出失败: ${err.message || '未知错误'}`)
  }
}
