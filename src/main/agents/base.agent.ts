import { v4 as uuidv4 } from 'uuid'
import type { Tool } from '@langchain/core/tools'
import { getEffectiveSkillsForAgent, formatSkillsForPrompt, getSkillsByIds } from './agent-skills.service'
import { createChatModel } from '../llm'
import { streamChat } from '../llm/stream-handler'
import { ensurePi } from '../pi'
import { runWithPi } from '../pi/agent-runner'

export type BuiltinAgentType = 'orchestrator' | 'general' | 'aero' | 'structural' | 'propulsion' | 'avionics' | 'simulation' | 'documentation' | 'retriever'
export type AgentType = BuiltinAgentType | string

export type AgentEngine = 'deepseek' | 'pi'

export type AgentState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error'

export interface AgentConfig {
  type: AgentType
  name: string
  color: string
  modelName: string
  icon: string
  engine?: AgentEngine  // 底层 LLM 引擎：'deepseek' (LangChain 直连) | 'pi' (Pi SDK)
  delegatesTo?: string[]  // list of agent types this agent can delegate to
  toolNames?: string[]    // 工具名列表（来自 DB tools 字段，覆盖默认 BUILTIN_TOOL_MAP）
}

export interface AgentOverrideConfig {
  name?: string
  color?: string
  icon?: string
  modelName?: string
  systemPrompt?: string
  toolNames?: string[]
  keywords?: string[]
  delegatesTo?: string[]
  subtaskPrefix?: string
  engine?: AgentEngine
}

export interface StreamChunk {
  messageId: string
  agentType: AgentType
  content: string
  statusChange?: AgentStatusData
  toolCall?: ToolCallData
  thinking?: string  // 思考过程增量（Pi SDK thinking_delta 事件流）
  agentMessage?: AgentMessage  // agent 间结构化消息，由 orchestrator 解析后转发到渲染端
  isComplete: boolean
}

export interface AgentStatusData {
  agentType: AgentType
  name: string
  color: string
  state: AgentState
  currentTask?: string
}

export interface ToolCallData {
  toolCallId?: string  // Pi 工具调用 ID，用于 start/end 配对更新
  tool: string
  input: string
  output: string
  isComplete?: boolean  // false=执行中（占位），true=已结束（含最终 output）
}

export interface AgentMessage {
  id: string
  fromAgent: AgentType
  toAgent: AgentType | 'all'
  type: 'request' | 'response' | 'notification'
  content: string
  params?: Record<string, unknown>
  confidence?: number
  timestamp: number
}

export interface AgentContext {
  conversationId: string
  signal: AbortSignal
  chatHistory?: Array<{ role: string; content: string; agent_type?: string }>
  ragContext?: string
  delegationDepth?: number  // track delegation nesting depth, default 0
  selectedAgent?: string  // UI 选择的 agent 类型（'general' 或具体专业 agent），由 chat.ipc 透传
  dispatchMode?: 'single' | 'collaborative'  // 调度模式：single=单Agent直连 | collaborative=协调器关键词并发调度
  fileWorkspacePath?: string  // 文件读写工具的合法根目录（用户在对话框下方"工作空间"按钮设置），未设置则 agent 无文件工具
  forcedSkillIds?: string[]  // 用户在对话中通过 "/" 主动注入的技能 ID，绕过关键词匹配直接注入
}

// Agent 间主动通信协议（注入到每个 agent 的 system prompt 末尾）
// agent 在分析输出末尾用 <<<AGENT_MSG>>>{json}<<</AGENT_MSG>>> 标记发送结构化消息
export const AGENT_MESSAGING_PROTOCOL = `## 与其他 Agent 主动通信（可选）

当你需要其他领域的 Agent 提供数据、确认假设、或通知关键结论时，可以在分析末尾发送结构化消息。

### 消息格式（输出在正文末尾，可多条）
<<<AGENT_MSG>>>
{"toAgent": "structural", "type": "request", "content": "请计算机翼根部弯矩，给定升力分布...", "confidence": 0.8}
<<</AGENT_MSG>>>

### 字段说明
- toAgent: 目标 Agent 类型（如 structural, aero, simulation, propulsion, avionics, documentation, retriever）
- type: "request"（请求数据/分析）| "response"（回应请求）| "notification"（通知结论）
- content: 消息正文，简洁明确
- confidence: 0-1，你对本次消息内容的置信度

### 使用时机
- 你需要其他领域的数据才能完成分析时 → type="request"
- 你已完成分析并希望其他 Agent 知晓关键结论时 → type="notification"
- 你在回应其他 Agent 早先的请求时 → type="response"

### 注意
- 不要在消息中重复正文已有的内容
- 仅在确有必要时发送，避免无意义广播
- 消息标记不会展示给最终用户，会由协调器解析后路由`

// 将 AgentContext.chatHistory 转换为 LangChain BaseMessage 数组
// 不再硬性 slice，由 handleUserMessage 的 compressContext 负责控制总 token 数
// 这样压缩摘要（system 消息）能完整保留，agent 可看到完整持续上下文
export function buildChatHistory(context: AgentContext): Array<import('@langchain/core/messages').BaseMessage> {
  const { HumanMessage, AIMessage, SystemMessage } = require('@langchain/core/messages')
  return (context.chatHistory || [])
    .filter((m) => m.role === 'user' || m.role === 'assistant' || m.role === 'agent' || m.role === 'system')
    .map((m) => {
      if (m.role === 'user') return new HumanMessage(m.content)
      // system 角色用 SystemMessage（压缩摘要等），不要 fall through 到 AIMessage
      if (m.role === 'system') return new SystemMessage(m.content)
      // agent/assistant 消息带 agent_type 标签，让 LLM 知道是哪个 agent 说的
      const label = m.agent_type ? `[${m.agent_type}] ` : ''
      return new AIMessage(label + m.content)
    })
}

// 所有 Agent 的统一接口
export interface IAgent {
  readonly config: AgentConfig
  getState(): AgentState
  setState(state: AgentState): void
  forceReset(): void
  run(task: string, context: AgentContext): AsyncGenerator<StreamChunk>
  sendMessage(msg: AgentMessage): void
  receiveMessage(msg: AgentMessage): void
  getPendingMessages(): AgentMessage[]
  clearPendingMessages(): void
  getAvailableTools(context?: AgentContext): Tool[]
}

// Agent 基类，提供默认实现
export abstract class BaseAgent implements IAgent {
  abstract readonly config: AgentConfig
  protected stateMachine: { getState: () => AgentState; transition: (s: AgentState) => boolean; reset: () => void } | null = null
  protected systemPrompt: string = ''
  private messageQueue: AgentMessage[] = []

  protected setStateMachine(sm: { getState: () => AgentState; transition: (s: AgentState) => boolean; reset: () => void }): void {
    this.stateMachine = sm
  }

  getState(): AgentState {
    return this.stateMachine?.getState() ?? 'idle'
  }

  setState(state: AgentState): void {
    this.stateMachine?.transition(state)
  }

  forceReset(): void {
    this.stateMachine?.reset()
  }

  abstract run(task: string, context: AgentContext): AsyncGenerator<StreamChunk>

  sendMessage(msg: AgentMessage): void {
    // Delegate to message bus via the agent registry
    const { agentMessageBus } = require('./agent-message-bus')
    agentMessageBus.publish(msg)
  }

  receiveMessage(msg: AgentMessage): void {
    this.messageQueue.push(msg)
  }

  getPendingMessages(): AgentMessage[] {
    return [...this.messageQueue]
  }

  clearPendingMessages(): void {
    this.messageQueue = []
  }

  getAvailableTools(_context?: AgentContext): Tool[] {
    return []
  }

  protected resetState(): void {
    this.stateMachine?.reset()
  }

  // 将队列中待处理消息格式化为前缀上下文，并清空队列
  // 在子类 run() 入口调用 prepareTaskWithContext() 即可注入
  protected buildMessageContext(): string {
    const pending = this.getPendingMessages()
    if (pending.length === 0) return ''
    this.clearPendingMessages()
    const lines = pending.map((m) => {
      const conf = typeof m.confidence === 'number' ? `, 置信度 ${m.confidence}` : ''
      return `- 📨 来自 ${m.fromAgent} (${m.type}${conf}): ${m.content}`
    })
    return `[来自其他 Agent 的消息]\n${lines.join('\n')}\n[/来自其他 Agent 的消息]\n\n请在分析中考虑以上信息。对 request 类型消息需直接回应。`
  }

  // 将消息上下文与原始任务拼接为最终 userMessage
  protected prepareTaskWithContext(task: string): string {
    const ctx = this.buildMessageContext()
    return ctx ? `${ctx}\n\n[原始任务]\n${task}` : task
  }

  // 在子类 systemPrompt 末尾追加通信协议 + 匹配的技能（过程性知识）
  // task 用于技能关键词匹配：无 task 时只注入"始终启用"类技能
  // context.forcedSkillIds（用户 "/" 主动选择）绕过关键词/目标匹配，排最前且不受 top10 上限
  protected getEffectiveSystemPrompt(task?: string, context?: AgentContext): string {
    const forced = context?.forcedSkillIds?.length ? getSkillsByIds(context.forcedSkillIds) : []
    const matched = getEffectiveSkillsForAgent(this.config.type, task || '')
    const forcedIds = new Set(forced.map((s) => s.id))
    const skills = [...forced, ...matched.filter((s) => !forcedIds.has(s.id))]
    const skillsSection = skills.length > 0 ? `\n\n${formatSkillsForPrompt(skills)}` : ''
    return `${this.systemPrompt}\n\n${AGENT_MESSAGING_PROTOCOL}${skillsSection}`
  }

  // 统一的 LLM 流式调用入口：根据 config.engine 分流到 Pi 或 DeepSeek
  //
  // 子类 run() 在 yield 完 thinking/working 状态后调用：
  //   yield* this.streamLLM(task, context, messageId)
  // 此方法会自动处理：
  //   - Pi engine: 加载 Pi SDK（失败回退 DeepSeek），调共享 runner
  //   - DeepSeek engine: 走 LangChain streamChat，绑定子类 getAvailableTools() 返回的工具
  //
  // 返回 StreamChunk（agentType 已填好），子类直接 yield* 即可。
  protected async *streamLLM(
    task: string,
    context: AgentContext,
    messageId: string,
    ragContextOverride?: string
  ): AsyncGenerator<StreamChunk> {
    const effectiveRag = ragContextOverride ?? context.ragContext
    const usePi = await this.shouldUsePi()
    if (usePi) {
      yield* runWithPi(context, {
        agentType: this.config.type,
        agentName: this.config.name,
        agentColor: this.config.color,
        systemPrompt: this.getEffectiveSystemPrompt(task, context),
        task: this.prepareTaskWithContext(task),
        ragContext: effectiveRag,
        customTools: this.getAvailableTools(context)
      })
      return
    }

    // DeepSeek + LangChain 路径
    const llm = createChatModel({ modelName: this.config.modelName })
    const tools = this.getAvailableTools(context)

    const stream = streamChat(llm, {
      systemPrompt: this.getEffectiveSystemPrompt(task, context),
      userMessage: this.prepareTaskWithContext(task),
      chatHistory: buildChatHistory(context),
      ragContext: effectiveRag,
      tools,
      signal: context.signal
    })

    for await (const chunk of stream) {
      if (context.signal.aborted) break
      if (typeof chunk === 'string') {
        yield { messageId, agentType: this.config.type, content: chunk, isComplete: false }
      } else {
        const tc = chunk as { type: 'tool_call'; tool: string; input: string; output: string }
        yield {
          messageId,
          agentType: this.config.type,
          content: '',
          toolCall: { tool: tc.tool, input: tc.input, output: tc.output, isComplete: true },
          isComplete: false
        }
      }
    }
  }

  // 是否走 Pi 引擎：engine === 'pi' 且 SDK 加载成功；否则回退 DeepSeek
  private async shouldUsePi(): Promise<boolean> {
    if (this.config.engine !== 'pi') return false
    try {
      await ensurePi()
      return true
    } catch (err: any) {
      console.warn(`[${this.config.type}] Pi SDK load failed, falling back to DeepSeek:`, err?.message || err)
      return false
    }
  }
}
