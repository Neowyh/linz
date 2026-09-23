import { useCallback, useEffect, useRef } from 'react'
import { v4 as uuidv4 } from 'uuid'
import { useChatStore } from '../stores/chatStore'
import { useConversationStore } from '../stores/conversationStore'
import { useAgentStore } from '../stores/agentStore'
import { asText } from '../utils/text'
import type { ToolCallEntry, SkillTriggerInfo } from '../types/chat'

// 解析 DB 中持久化的 tool_calls JSON；旧数据或解析失败返回 undefined
// 历史脏数据里 input/output 可能存成了对象，直接渲染会触发 React #31 白屏，
// 这里在加载时统一规整为字符串。
function parseToolCalls(raw: string | null | undefined): ToolCallEntry[] | undefined {
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed) || parsed.length === 0) return undefined
    return parsed.map((c: any) => ({
      ...c,
      tool: asText(c.tool),
      input: asText(c.input),
      output: asText(c.output)
    }))
  } catch {
    return undefined
  }
}

// 解析 DB 中持久化的 skill_triggers JSON；旧数据或解析失败返回 undefined
function parseSkillTriggers(raw: string | null | undefined): SkillTriggerInfo[] | undefined {
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
  const startStreaming = useChatStore((s) => s.startStreaming)
  const setConversation = useChatStore((s) => s.setConversation)
  const fetchConversations = useConversationStore((s) => s.fetchConversations)
  const incrementActiveTasks = useAgentStore((s) => s.incrementActiveTasks)
  const incrementCompletedTasks = useAgentStore((s) => s.incrementCompletedTasks)

  // 跟踪当前流式对话ID，用于在 streamEnd 时更新统计
  const streamingConvIdRef = useRef<string | null>(null)

  // 监听流结束事件（替代轮询）
  // 主进程在旧流被新流抢占时仍会发 streamEnd（带旧 conversationId），
  // 这里按 conversationId 过滤：只结束当前对话的流式状态，避免跨对话竞态把新流抹掉。
  useEffect(() => {
    const unsubscribe = window.aeromind.chat.onStreamEnd((data: { conversationId?: string }) => {
      const endedConvId = data?.conversationId
      const currentConvId = useChatStore.getState().conversationId
      if (endedConvId && currentConvId && endedConvId !== currentConvId) {
        // 旧对话的 streamEnd，当前对话仍在流式，忽略
        return
      }
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
      addUserMessage(convId, userMsgId, content)

      // 立即置为流式等待状态：模型首个 chunk 到达前，对话底部即显示"动态等待标志"
      startStreaming(convId, userMsgId)

      // 通知主进程处理，携带当前选择的 agent 与调度模式
      const { selectedAgent, dispatchMode } = useChatStore.getState()
      window.aeromind.chat.sendMessage(convId, content, selectedAgent, dispatchMode, skillIds)
      incrementActiveTasks()
      streamingConvIdRef.current = convId
    },
    [conversationId, addUserMessage, startStreaming, setConversation, incrementActiveTasks]
  )

  const abort = useCallback(() => {
    window.aeromind.chat.abort()
  }, [])

  const loadConversation = useCallback(
    async (id: string) => {
      // 命中内存缓存（切走但仍在流式/已完成的对话）→ 直接恢复、跳过 DB 重载，
      // 避免把后台正在生成的回复用 DB 的旧状态覆盖丢失
      if (useChatStore.getState().hasLiveConversationCache(id)) {
        setConversation(id)
        return
      }
      setConversation(id)
      const detail = await window.aeromind.conversation.get(id)
      if (detail && detail.messages) {
        const chatMessages = detail.messages.map((msg) => ({
          id: msg.id,
          role: msg.role as 'user' | 'assistant' | 'agent',
          agentType: (msg.agent_type as any) || undefined,
          content: msg.content,
          toolCalls: parseToolCalls((msg as any).tool_calls),
          skillTriggers: parseSkillTriggers((msg as any).skill_triggers),
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
