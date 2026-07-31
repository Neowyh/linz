import { useCallback, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useChatStore } from '../stores/chatStore'
import { useConversationStore } from '../stores/conversationStore'
import { useAgentStore } from '../stores/agentStore'
import type { ToolCallEntry } from '../types/chat'

// 解析 DB 中持久化的 tool_calls JSON；旧数据或解析失败返回 undefined
function parseToolCalls(raw: string | null | undefined): ToolCallEntry[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined
  } catch {
    return undefined
  }
}

export function useChat() {
  const conversationId = useChatStore((s) => s.conversationId)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const addUserMessage = useChatStore((s) => s.addUserMessage)
  const setConversation = useChatStore((s) => s.setConversation)
  const fetchConversations = useConversationStore((s) => s.fetchConversations)
  const incrementActiveTasks = useAgentStore((s) => s.incrementActiveTasks)
  const incrementCompletedTasks = useAgentStore((s) => s.incrementCompletedTasks)

  // 跟踪当前流式对话ID，用于在 streamEnd 时更新统计
  const streamingConvIdRef = useRef<string | null>(null)

  // 监听流结束事件（替代轮询）
  useEffect(() => {
    const unsubscribe = window.aeromind.chat.onStreamEnd(() => {
      incrementCompletedTasks()
      fetchConversations()
      streamingConvIdRef.current = null
    })
    return unsubscribe
  }, [incrementCompletedTasks, fetchConversations])

  const sendMessage = useCallback(
    async (content: string, skillIds?: string[]) => {
      let convId = conversationId

      // 如果没有当前对话，创建一个新的
      if (!convId) {
        convId = await useConversationStore.getState().createConversation()
        setConversation(convId)
      }

      // 添加用户消息到本地状态
      const userMsgId = uuidv4()
      addUserMessage(userMsgId, content)

      // 通知主进程处理，携带当前选择的 agent 与调度模式
      const { selectedAgent, dispatchMode } = useChatStore.getState()
      window.aeromind.chat.sendMessage(convId, content, selectedAgent, dispatchMode, skillIds)
      incrementActiveTasks()
      streamingConvIdRef.current = convId
    },
    [conversationId, addUserMessage, setConversation, incrementActiveTasks]
  )

  const abort = useCallback(() => {
    window.aeromind.chat.abort()
  }, [])

  const loadConversation = useCallback(
    async (id: string) => {
      setConversation(id)
      const detail = await window.aeromind.conversation.get(id)
      if (detail && detail.messages) {
        const chatMessages = detail.messages.map((msg) => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'agent',
          agentType: (msg.agent_type as any) || undefined,
          content: msg.content,
          toolCalls: parseToolCalls((msg as any).tool_calls),
          isStreaming: false,
          createdAt: msg.created_at
        }))
        useChatStore.getState().loadMessages(chatMessages)
      }
    },
    [setConversation]
  )

  return {
    conversationId,
    isStreaming,
    sendMessage,
    abort,
    loadConversation
  }
}
