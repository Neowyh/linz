import type { AgentType } from './agent'

export interface ToolCallEntry {
  toolCallId?: string
  tool: string
  input: string
  output: string
  isComplete?: boolean
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'agent'
  agentType?: AgentType
  content: string
  thinking?: string  // agent 思考过程（Pi thinking_delta 累积）
  toolCalls?: ToolCallEntry[]  // 工具调用记录
  isStreaming?: boolean
  createdAt: string
}

export interface ConversationSummary {
  id: string
  title: string | null
  created_at: string
  updated_at: string
  task_type: string | null
  agents_used: string
  total_tokens: number
  status: string
}

export interface ConversationDetail extends ConversationSummary {
  messages: ChatMessage[]
}

export interface TaskTemplate {
  id: string
  icon: string
  title: string
  description: string
  category: string
  prompt: string
}
