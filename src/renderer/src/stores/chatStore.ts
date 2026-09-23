import { create } from 'zustand'
import type { ChatMessage, ToolCallEntry, SkillTriggerInfo } from '../types/chat'
import type { AgentType } from '../types/agent'
import { asText } from '../utils/text'

// 后台对话缓存槽：切走但仍在流式 / 已完成的对话状态在此保留，切回即恢复，
// 不再因切换对话被全局 messages 覆盖丢失。
interface ConversationCacheSlot {
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
}

interface ChatState {
  conversationId: string | null
  // 活跃对话视图（= 当前对话的状态）；现有消费者直接读这三个字段
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  // 非当前对话的缓存：切走时快照进来，切回时恢复
  conversationCache: Record<string, ConversationCacheSlot>
  selectedAgent: string
  dispatchMode: 'single' | 'collaborative'
  pendingInput: string

  setConversation: (id: string | null) => void
  hasLiveConversationCache: (id: string) => boolean
  findConversationByMessageId: (messageId: string) => string | null
  addUserMessage: (conversationId: string, id: string, content: string) => void
  addAgentMessage: (conversationId: string, id: string, agentType: AgentType) => void
  appendStreamChunk: (conversationId: string, messageId: string, chunk: string) => void
  appendThinking: (conversationId: string, messageId: string, delta: string) => void
  upsertToolCall: (conversationId: string, messageId: string, toolCall: ToolCallEntry) => void
  addSkillTriggers: (conversationId: string, messageId: string, triggers: SkillTriggerInfo[]) => void
  startStreaming: (conversationId: string, messageId: string) => void
  endStreaming: (conversationId?: string) => void
  clearMessages: () => void
  loadMessages: (messages: ChatMessage[]) => void
  setSelectedAgent: (agent: string) => void
  setDispatchMode: (mode: 'single' | 'collaborative') => void
  setPendingInput: (input: string) => void
  clearPendingInput: () => void
}

// 在 messages 数组里按 messageId 定位并替换该条；找不到返回 null（调用方据此跳过）。
function replaceMessage(
  messages: ChatMessage[],
  messageId: string,
  replacer: (m: ChatMessage) => ChatMessage
): ChatMessage[] | null {
  const idx = messages.findIndex((m) => m.id === messageId)
  if (idx < 0) return null
  const next = [...messages]
  next[idx] = replacer(messages[idx])
  return next
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversationId: null,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  conversationCache: {},
  selectedAgent: 'general',
  dispatchMode: 'single',
  pendingInput: '',

  // 切换对话：快照旧活跃槽进缓存、恢复新对话（命中缓存即取、否则清空活跃视图待 DB 填充）。
  setConversation: (id) =>
    set((state) => {
      if (id === state.conversationId) return state
      const cache = { ...state.conversationCache }
      if (state.conversationId) {
        cache[state.conversationId] = {
          messages: state.messages,
          isStreaming: state.isStreaming,
          streamingMessageId: state.streamingMessageId
        }
      }
      const cached = cache[id as string]
      const patch: Partial<ChatState> = { conversationId: id, conversationCache: cache }
      if (cached) {
        patch.messages = cached.messages
        patch.isStreaming = cached.isStreaming
        patch.streamingMessageId = cached.streamingMessageId
        delete cache[id as string]
      } else {
        patch.messages = []
        patch.isStreaming = false
        patch.streamingMessageId = null
      }
      return patch
    }),

  // 是否有该对话的内存缓存（切回时可直接恢复，跳过 DB 重载）
  hasLiveConversationCache: (id) => !!get().conversationCache[id],

  // 反查某 messageId 所属对话（审批事件无 conversationId 时的回退路由）
  findConversationByMessageId: (messageId) => {
    const s = get()
    if (s.conversationId && s.messages.some((m) => m.id === messageId)) return s.conversationId
    for (const [convId, slot] of Object.entries(s.conversationCache)) {
      if (slot.messages.some((m) => m.id === messageId)) return convId
    }
    return null
  },

  addUserMessage: (conversationId, id, content) =>
    set((state) => {
      const newMsg: ChatMessage = { id, role: 'user', content, isStreaming: false, createdAt: new Date().toISOString() }
      if (conversationId === state.conversationId) {
        return { messages: [...state.messages, newMsg] }
      }
      const slot = state.conversationCache[conversationId]
      const messages = slot ? [...slot.messages, newMsg] : [newMsg]
      return {
        conversationCache: {
          ...state.conversationCache,
          [conversationId]: { messages, isStreaming: slot?.isStreaming ?? false, streamingMessageId: slot?.streamingMessageId ?? null }
        }
      }
    }),

  // 幂等：messageId 已在目标槽则 no-op（替代旧的 activeAgentMessages ref 去重）
  addAgentMessage: (conversationId, id, agentType) =>
    set((state) => {
      const newMsg: ChatMessage = {
        id, role: 'agent', agentType, content: '', thinking: '', toolCalls: [], skillTriggers: [], isStreaming: true, createdAt: new Date().toISOString()
      }
      if (conversationId === state.conversationId) {
        if (state.messages.some((m) => m.id === id)) return state
        return { messages: [...state.messages, newMsg], streamingMessageId: id, isStreaming: true }
      }
      const slot = state.conversationCache[conversationId]
      if (slot && slot.messages.some((m) => m.id === id)) return state
      const messages = slot ? [...slot.messages, newMsg] : [newMsg]
      return {
        conversationCache: {
          ...state.conversationCache,
          [conversationId]: { messages, isStreaming: true, streamingMessageId: id }
        }
      }
    }),

  appendStreamChunk: (conversationId, messageId, chunk) =>
    set((state) => {
      if (conversationId === state.conversationId) {
        const next = replaceMessage(state.messages, messageId, (m) => ({ ...m, content: m.content + chunk }))
        return next === null ? state : { messages: next }
      }
      const slot = state.conversationCache[conversationId]
      if (!slot) return state
      const next = replaceMessage(slot.messages, messageId, (m) => ({ ...m, content: m.content + chunk }))
      if (next === null) return state
      return { conversationCache: { ...state.conversationCache, [conversationId]: { ...slot, messages: next } } }
    }),

  appendThinking: (conversationId, messageId, delta) =>
    set((state) => {
      if (conversationId === state.conversationId) {
        const next = replaceMessage(state.messages, messageId, (m) => ({ ...m, thinking: (m.thinking || '') + delta }))
        return next === null ? state : { messages: next }
      }
      const slot = state.conversationCache[conversationId]
      if (!slot) return state
      const next = replaceMessage(slot.messages, messageId, (m) => ({ ...m, thinking: (m.thinking || '') + delta }))
      if (next === null) return state
      return { conversationCache: { ...state.conversationCache, [conversationId]: { ...slot, messages: next } } }
    }),

  // 工具调用按 toolCallId 更新；无 ID 或新 ID 一律新增
  // 入库前对 input/output/tool 做 asText 规整：主进程任何路径若把对象
  // 透传进来，store 不应留存非字符串值（否则渲染层兜底前可能先触发 #31）。
  // 仅规整"已出现"的字段（undefined 保留），避免部分更新抹掉既有值。
  upsertToolCall: (conversationId, messageId, toolCall) =>
    set((state) => {
      const apply = (messages: ChatMessage[]): ChatMessage[] | null => {
        const idx = messages.findIndex((m) => m.id === messageId)
        if (idx < 0) return null
        const target = messages[idx]
        const calls = target.toolCalls ? [...target.toolCalls] : []
        const norm: ToolCallEntry = {
          ...toolCall,
          tool: toolCall.tool !== undefined ? asText(toolCall.tool) : toolCall.tool,
          input: toolCall.input !== undefined ? asText(toolCall.input) : toolCall.input,
          output: toolCall.output !== undefined ? asText(toolCall.output) : toolCall.output
        }
        if (norm.toolCallId) {
          const tIdx = calls.findIndex((c) => c.toolCallId === norm.toolCallId)
          if (tIdx >= 0) {
            calls[tIdx] = { ...calls[tIdx], ...norm }
          } else {
            calls.push(norm)
          }
        } else {
          calls.push(norm)
        }
        const next = [...messages]
        next[idx] = { ...target, toolCalls: calls }
        return next
      }
      if (conversationId === state.conversationId) {
        const next = apply(state.messages)
        return next === null ? state : { messages: next }
      }
      const slot = state.conversationCache[conversationId]
      if (!slot) return state
      const next = apply(slot.messages)
      if (next === null) return state
      return { conversationCache: { ...state.conversationCache, [conversationId]: { ...slot, messages: next } } }
    }),

  // 技能触发信息按 skillId 去重累积（同一技能可能强制+匹配重复报告）
  addSkillTriggers: (conversationId, messageId, triggers) =>
    set((state) => {
      const apply = (messages: ChatMessage[]): ChatMessage[] | null => {
        const idx = messages.findIndex((m) => m.id === messageId)
        if (idx < 0) return null
        const target = messages[idx]
        const existing = target.skillTriggers ? [...target.skillTriggers] : []
        for (const t of triggers) {
          if (!existing.some((e) => e.skillId === t.skillId)) existing.push(t)
        }
        const next = [...messages]
        next[idx] = { ...target, skillTriggers: existing }
        return next
      }
      if (conversationId === state.conversationId) {
        const next = apply(state.messages)
        return next === null ? state : { messages: next }
      }
      const slot = state.conversationCache[conversationId]
      if (!slot) return state
      const next = apply(slot.messages)
      if (next === null) return state
      return { conversationCache: { ...state.conversationCache, [conversationId]: { ...slot, messages: next } } }
    }),

  startStreaming: (conversationId, messageId) =>
    set((state) => {
      if (conversationId === state.conversationId) {
        return { isStreaming: true, streamingMessageId: messageId }
      }
      const slot = state.conversationCache[conversationId]
      return {
        conversationCache: {
          ...state.conversationCache,
          [conversationId]: {
            messages: slot?.messages ?? [],
            isStreaming: true,
            streamingMessageId: messageId
          }
        }
      }
    }),

  // 按 conversationId 作用域结束流式：后台对话结束只动它的缓存槽，
  // 不再把当前对话的 isStreaming 一并抹掉（修复跨对话 streamEnd 串扰）。
  endStreaming: (conversationId) =>
    set((state) => {
      if (conversationId && conversationId !== state.conversationId) {
        const slot = state.conversationCache[conversationId]
        if (!slot) return state
        let changed = false
        const nextMsgs = slot.messages.map((msg) => {
          if (msg.isStreaming) { changed = true; return { ...msg, isStreaming: false } }
          return msg
        })
        return {
          conversationCache: {
            ...state.conversationCache,
            [conversationId]: { messages: changed ? nextMsgs : slot.messages, isStreaming: false, streamingMessageId: null }
          }
        }
      }
      // 当前对话（或未传 conversationId）：定点更新活跃视图
      let changed = false
      const next = state.messages.map((msg) => {
        if (msg.isStreaming) { changed = true; return { ...msg, isStreaming: false } }
        return msg
      })
      if (!changed) return { isStreaming: false, streamingMessageId: null }
      return { isStreaming: false, streamingMessageId: null, messages: next }
    }),

  // 清空活跃视图（进裸 /chat、新建对话）；若当前对话仍在流式，先快照进缓存让其后台续跑
  clearMessages: () =>
    set((state) => {
      const cache = { ...state.conversationCache }
      if (state.conversationId) {
        cache[state.conversationId] = {
          messages: state.messages,
          isStreaming: state.isStreaming,
          streamingMessageId: state.streamingMessageId
        }
      }
      return { conversationId: null, messages: [], isStreaming: false, streamingMessageId: null, conversationCache: cache }
    }),

  loadMessages: (messages) => set({ messages, isStreaming: false, streamingMessageId: null }),

  setSelectedAgent: (agent) => set({ selectedAgent: agent }),

  setDispatchMode: (mode) => set({ dispatchMode: mode }),

  setPendingInput: (input) => set({ pendingInput: input }),

  clearPendingInput: () => set({ pendingInput: '' })
}))
