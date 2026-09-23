import { SystemMessage, HumanMessage, AIMessage, BaseMessage } from '@langchain/core/messages'
import { createChatModel } from './index'

export interface CompressedMessage {
  role: 'system' | 'human' | 'ai'
  content: string
}

interface MessageLike {
  role: string
  content: string
  agent_type?: string
}

// Rough token estimation: Chinese chars x2 + English words x1.3
// 注意：base64 data URL 等无空格超长串会被 split(/\s+/) 当成单个"词"，
// 导致一张 4MB 图片（约百万 token）只算 ~1.3 token，压缩器永远不触发。
// 对超过 100 字符的无空格串按 ~4 字符/token 估算，让压缩器对图片数据生效。
export function estimateTokens(text: string): number {
  if (!text) return 0
  const chineseChars = (text.match(/[一-鿿]/g) || []).length
  const nonChinese = text.replace(/[一-鿿]/g, ' ')
  const words = nonChinese.split(/\s+/).filter((w) => w.length > 0)
  let tokens = chineseChars * 2
  for (const w of words) {
    tokens += w.length > 100 ? Math.ceil(w.length / 4) : 1.3
  }
  return Math.ceil(tokens)
}

export function estimateMessagesTokens(messages: MessageLike[]): number {
  return messages.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
}

function toBaseMessages(messages: MessageLike[]): BaseMessage[] {
  return messages.map((msg) => {
    if (msg.role === 'human' || msg.role === 'user') return new HumanMessage(msg.content)
    if (msg.role === 'ai' || msg.role === 'assistant') return new AIMessage(msg.content)
    return new SystemMessage(msg.content)
  })
}

async function generateSummary(messages: MessageLike[]): Promise<string> {
  const llm = createChatModel()
  // 体现 agent_type，让摘要能区分不同 agent 的发言
  const conversationText = messages
    .map((msg) => {
      if (msg.role === 'human' || msg.role === 'user') return `用户: ${msg.content}`
      if (msg.role === 'system') return `系统: ${msg.content}`
      const agentLabel = msg.agent_type ? ` (${msg.agent_type})` : ''
      return `助手${agentLabel}: ${msg.content}`
    })
    .join('\n')

  const prompt = `请将以下对话历史压缩为简洁摘要，保留关键设计决策、参数、工具调用结果和结论。注意区分不同专业 Agent 的发言：\n\n${conversationText}`

  const response = await llm.invoke([new HumanMessage(prompt)])
  return typeof response.content === 'string' ? response.content : String(response.content)
}

export async function compressContext(
  messages: MessageLike[],
  maxTokens: number = 200000
): Promise<MessageLike[]> {
  const totalTokens = estimateMessagesTokens(messages)

  // Under budget, return a copy (not the same reference) so callers can safely
  // mutate the original array without wiping the returned value.
  if (totalTokens <= maxTokens) {
    return messages.slice()
  }

  // 当 recent 窗口本身就超预算时，逐步缩减 recent 数量（最低保留 8 条），
  // 防止工具密集对话中 50 条 recent 各自带 10K 字符工具输出导致 payload 失控
  let recentCount = Math.min(50, messages.length)
  let recentMessages = messages.slice(-recentCount)
  let earlyMessages = messages.slice(0, -recentCount)

  // 若 earlyMessages 为空且 recent 仍超预算，逐步砍 recent
  while (earlyMessages.length === 0 && recentMessages.length > 8 && estimateMessagesTokens(recentMessages) > maxTokens) {
    recentCount = Math.max(8, Math.floor(recentMessages.length / 2))
    recentMessages = messages.slice(-recentCount)
    earlyMessages = messages.slice(0, -recentCount)
  }

  if (earlyMessages.length === 0) {
    // recent 已经压到最低仍超预算，按 token 估算从头部继续丢弃直到达标或只剩 8 条
    const trimmed = trimToFit(recentMessages, maxTokens)
    return trimmed
  }

  // Summarize early messages
  try {
    const summary = await generateSummary(earlyMessages)
    const summaryMessage: MessageLike = {
      role: 'system',
      content: `[对话历史摘要]\n${summary}`
    }
    const combined = [summaryMessage, ...recentMessages]
    // 二次校验：summary + recent 仍超预算时，从 recent 头部丢弃
    if (estimateMessagesTokens(combined) > maxTokens) {
      return trimToFit(combined, maxTokens)
    }
    return combined
  } catch (err) {
    console.warn('[ContextCompressor] Summary generation failed, falling back to truncation:', err)
    // Fallback: just keep recent messages, trimmed to fit
    return trimToFit(recentMessages, maxTokens)
  }
}

// 从头部丢弃消息直到总 token 数 <= maxTokens，最低保留最后 8 条
function trimToFit(messages: MessageLike[], maxTokens: number): MessageLike[] {
  if (messages.length <= 8) return messages
  let start = 0
  while (start < messages.length - 8) {
    const slice = messages.slice(start)
    if (estimateMessagesTokens(slice) <= maxTokens) return slice
    start++
  }
  return messages.slice(messages.length - 8)
}
