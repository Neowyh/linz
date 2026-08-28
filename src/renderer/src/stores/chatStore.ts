import { create } from 'zustand'
import type { ChatMessage, ToolCallEntry, SkillTriggerInfo } from '../types/chat'
import type { AgentType } from '../types/agent'

interface ChatState {
  conversationId: string | null
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  selectedAgent: string
  dispatchMode: 'single' | 'collaborative'
  pendingInput: string

  setConversation: (id: string | null) => void
  addUserMessage: (id: string, content: string) => void
  addAgentMessage: (id: string, agentType: AgentType) => void
  appendStreamChunk: (messageId: string, chunk: string) => void
  appendThinking: (messageId: string, delta: string) => void
  upsertToolCall: (messageId: string, toolCall: ToolCallEntry) => void
  addSkillTriggers: (messageId: string, triggers: SkillTriggerInfo[]) => void
  startStreaming: (messageId: string) => void
  endStreaming: (conversationId?: string) => void
  clearMessages: () => void
  loadMessages: (messages: ChatMessage[]) => void
  setSelectedAgent: (agent: string) => void
  setDispatchMode: (mode: 'single' | 'collaborative') => void
  setPendingInput: (input: string) => void
  clearPendingInput: () => void
}

export const useChatStore = create<ChatState>((set) => ({
  conversationId: null,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  selectedAgent: 'general',
  dispatchMode: 'single',
  pendingInput: '',

  setConversation: (id) => set({ conversationId: id }),

  addUserMessage: (id, content) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role: 'user',
          content,
          isStreaming: false,
          createdAt: new Date().toISOString()
        }
      ]
    })),

  addAgentMessage: (id, agentType) =>
    set((state) => ({
      messages: [
        ...state.messages,
        {
          id,
          role: 'agent',
          agentType,
          content: '',
          thinking: '',
          toolCalls: [],
          skillTriggers: [],
          isStreaming: true,
          createdAt: new Date().toISOString()
        }
      ],
      streamingMessageId: id,
      isStreaming: true
    })),

  appendStreamChunk: (messageId, chunk) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId ? { ...msg, content: msg.content + chunk } : msg
      )
    })),

  appendThinking: (messageId, delta) =>
    set((state) => ({
      messages: state.messages.map((msg) =>
        msg.id === messageId
          ? { ...msg, thinking: (msg.thinking || '') + delta }
          : msg
      )
    })),

  // 工具调用按 toolCallId 更新；无 ID 或新 ID 一律新增
  upsertToolCall: (messageId, toolCall) =>
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== messageId) return msg
        const calls = msg.toolCalls ? [...msg.toolCalls] : []
        if (toolCall.toolCallId) {
          const idx = calls.findIndex((c) => c.toolCallId === toolCall.toolCallId)
          if (idx >= 0) {
            calls[idx] = { ...calls[idx], ...toolCall }
            return { ...msg, toolCalls: calls }
          }
        }
        calls.push(toolCall)
        return { ...msg, toolCalls: calls }
      })
    })),

  // 技能触发信息按 skillId 去重累积（同一技能可能强制+匹配重复报告）
  addSkillTriggers: (messageId, triggers) =>
    set((state) => ({
      messages: state.messages.map((msg) => {
        if (msg.id !== messageId) return msg
        const existing = msg.skillTriggers ? [...msg.skillTriggers] : []
        for (const t of triggers) {
          if (!existing.some((e) => e.skillId === t.skillId)) existing.push(t)
        }
        return { ...msg, skillTriggers: existing }
      })
    })),

  startStreaming: (messageId) => set({ isStreaming: true, streamingMessageId: messageId }),

  // 仅当传入的 conversationId 与当前对话匹配（或未传，表示通用结束）时才结束流式，
  // 避免跨对话 abort 竞态：旧流的 streamEnd 不应把新对话的 isStreaming 抹掉。
  endStreaming: (conversationId?: string) =>
    set((state) => {
      if (conversationId && state.conversationId && conversationId !== state.conversationId) {
        return state
      }
      return {
        isStreaming: false,
        streamingMessageId: null,
        messages: state.messages.map((msg) =>
          msg.isStreaming ? { ...msg, isStreaming: false } : msg
        )
      }
    }),

  clearMessages: () => set({ messages: [], isStreaming: false, streamingMessageId: null }),

  loadMessages: (messages) => set({ messages, isStreaming: false, streamingMessageId: null }),

  setSelectedAgent: (agent) => set({ selectedAgent: agent }),

  setDispatchMode: (mode) => set({ dispatchMode: mode }),

  setPendingInput: (input) => set({ pendingInput: input }),

  clearPendingInput: () => set({ pendingInput: '' })
}))
