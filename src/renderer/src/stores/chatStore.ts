import { create } from 'zustand'
import type { ChatMessage, ToolCallEntry } from '../types/chat'
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
  startStreaming: (messageId: string) => void
  endStreaming: () => void
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

  startStreaming: (messageId) => set({ isStreaming: true, streamingMessageId: messageId }),

  endStreaming: () =>
    set((state) => ({
      isStreaming: false,
      streamingMessageId: null,
      messages: state.messages.map((msg) =>
        msg.isStreaming ? { ...msg, isStreaming: false } : msg
      )
    })),

  clearMessages: () => set({ messages: [], isStreaming: false, streamingMessageId: null }),

  loadMessages: (messages) => set({ messages, isStreaming: false, streamingMessageId: null }),

  setSelectedAgent: (agent) => set({ selectedAgent: agent }),

  setDispatchMode: (mode) => set({ dispatchMode: mode }),

  setPendingInput: (input) => set({ pendingInput: input }),

  clearPendingInput: () => set({ pendingInput: '' })
}))
