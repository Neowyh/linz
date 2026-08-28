import { useEffect, useRef } from 'react'
import type { ChatMessage } from '../../types/chat'
import { useChatStore } from '../../stores/chatStore'
import ChatMessageItem from './ChatMessage'
import TypingIndicator from './TypingIndicator'

interface MessageListProps {
  messages: ChatMessage[]
}

export default function MessageList({ messages }: MessageListProps): JSX.Element {
  const bottomRef = useRef<HTMLDivElement>(null)
  const isStreaming = useChatStore((s) => s.isStreaming)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // 模型回答前：流已开始但末尾仍是用户消息（首个 Agent 气泡尚未出现）时，
  // 显示独立"动态等待气泡"，避免用户误以为模型没有在工作
  const lastMsg = messages[messages.length - 1]
  const showWaiting = isStreaming && messages.length > 0 && !lastMsg.isStreaming

  return (
    <div className="flex-1 overflow-y-auto px-6 py-4">
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
