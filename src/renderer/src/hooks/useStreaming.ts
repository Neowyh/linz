import { useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAgentStore } from '../stores/agentStore'
import type { AgentType } from '../types/agent'
import type { ToolCallEntry } from '../types/chat'

export function useStreaming(): void {
  const addAgentMessage = useChatStore((s) => s.addAgentMessage)
  const appendStreamChunk = useChatStore((s) => s.appendStreamChunk)
  const appendThinking = useChatStore((s) => s.appendThinking)
  const upsertToolCall = useChatStore((s) => s.upsertToolCall)
  const endStreaming = useChatStore((s) => s.endStreaming)
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus)

  // 跟踪当前活跃的 Agent 消息，避免重复创建
  const activeAgentMessages = useRef<Map<string, string>>(new Map())

  useEffect(() => {
    const unsubChunk = window.aeromind.chat.onStreamChunk((data) => {
      const { messageId, agentType, chunk, toolCall, thinking } = data

      // 如果这个 messageId 还没有对应的消息，先创建
      if (!activeAgentMessages.current.has(messageId)) {
        activeAgentMessages.current.set(messageId, agentType)
        addAgentMessage(messageId, agentType as AgentType)
      }

      if (chunk) {
        appendStreamChunk(messageId, chunk)
      }
      if (thinking) {
        appendThinking(messageId, thinking)
      }
      if (toolCall) {
        upsertToolCall(messageId, toolCall as ToolCallEntry)
      }
    })

    const unsubEnd = window.aeromind.chat.onStreamEnd(() => {
      endStreaming()
      activeAgentMessages.current.clear()
    })

    const unsubError = window.aeromind.chat.onStreamError((data) => {
      console.error('Stream error:', data.error)
      endStreaming()
      activeAgentMessages.current.clear()
    })

    const unsubStatus = window.aeromind.agent.onStatusUpdate((data) => {
      updateAgentStatus(data)
    })

    return () => {
      unsubChunk()
      unsubEnd()
      unsubError()
      unsubStatus()
    }
  }, [addAgentMessage, appendStreamChunk, appendThinking, upsertToolCall, endStreaming, updateAgentStatus])
}
