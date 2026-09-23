import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../types/chat'
import { useChatStore } from '../../stores/chatStore'
import ChatMessageItem from './ChatMessage'
import TypingIndicator from './TypingIndicator'

interface MessageListProps {
  messages: ChatMessage[]
}

// 距底不超过此像素则视为"已在底部附近"，流式新消息才自动跟进；用户上翻查阅历史时不打断。
const STICK_THRESHOLD = 80

export default function MessageList({ messages }: MessageListProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const isStreaming = useChatStore((s) => s.isStreaming)
  // 记录最近一次消息长度，用于区分"同对话追加（流式）"与"切换对话（整体替换）"
  const prevLenRef = useRef<number>(messages.length)
  const convId = useChatStore((s) => s.conversationId)
  const prevConvRef = useRef<string | null>(convId)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const justSwitched = convId !== prevConvRef.current
    prevConvRef.current = convId
    const grew = messages.length > prevLenRef.current
    prevLenRef.current = messages.length

    // 切换对话：瞬切到底（auto，不平滑，避免大列表平滑滚动抖动）
    if (justSwitched) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
      return
    }
    // 同对话追加：仅当用户已在底部附近时才跟进（不抢用户滚动位置）
    const distFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    if (grew && distFromBottom <= STICK_THRESHOLD) {
      bottomRef.current?.scrollIntoView({ behavior: 'auto', block: 'end' })
    }
    // 非追加、非切换（如编辑状态变更）不动滚动位置
  }, [messages, convId])

  // 模型回答前：流已开始但末尾仍是用户消息（首个 Agent 气泡尚未出现）时，
  // 显示独立"动态等待气泡"，避免用户误以为模型没有在工作
  const lastMsg = messages[messages.length - 1]
  const showWaiting = isStreaming && messages.length > 0 && !lastMsg.isStreaming

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-6 py-4">
      <div className="max-w-3xl mx-auto">
        {messages.map((msg) => (
          <ChatMessageItem key={msg.id} message={msg} />
        ))}
        {showWaiting && <TypingIndicator standalone />}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
