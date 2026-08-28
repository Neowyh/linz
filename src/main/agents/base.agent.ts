import { v4 as uuidv4 } from 'uuid'
import type { Tool } from '@langchain/core/tools'
import { formatSkillsForPrompt, resolveEffectiveSkills, type SkillTriggerInfo } from './agent-skills.service'
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
  skillTriggers?: SkillTriggerInfo[]  // 本 agent 注入的技能触发信息（强制/关键词匹配），用于 UI 展示
  stepProgress?: StepProgressData  // 步骤进度（计划/完成），驱动悬浮进度卡片
  panelAction?: PanelCommandPayload  // 面板指令（解析自 ⟪PANEL⟫ 标记），驱动右侧 dock 工具面板自动打开并加载
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

// 步骤进度：由 Agent 的 ⟪STEP_PLAN⟫ / ⟪STEP_DONE⟫ 标记解析而来
export interface StepProgressData {
  steps: string[]  // 计划步骤标题（首次 PLAN 后填充）
  doneIndex: number  // 已完成步骤索引（-1 表示无完成标记）
}

// 面板指令 payload：由 Agent 的 ⟪PANEL⟫{panelType}|k=v|k=v⟫/PANEL⟫ 标记解析而来
// 主进程只解析字段，渲染端 dispatch 时补 id/createdAt
export interface PanelCommandPayload {
  panelType: string  // 'browser'|'terminal'|'files'|'kb'|'viewer3d'|'field'|'sql'
  action: string  // 'open'|'load'|'navigate'|'search'|'ask'|'run'...
  payload: Record<string, unknown>  // { path?, url?, query?, zone?, var?, docIds? }
  sourceMessageId?: string  // 来自哪条对话消息（用于双向高亮回溯）
  instanceId?: string  // 多实例面板（browser/terminal）路由到指定实例；空=聚焦/新建
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

// 安全边界上下文：由 base agent 在调用 streamChat 时注入，
// 供 stream-handler 在工具执行前做策略判定、发起审批、切换 waiting 状态。
export interface SecurityContext {
  agentType: AgentType
  agentName: string
  agentColor: string
  conversationId: string
  messageId: string  // 对应聊天流中该 agent 的消息气泡 id（审批卡定位用）
  setState: (state: AgentState) => void
}

// ===== 步骤进度协议 =====
// Agent 在流式输出时用结构化标记描述"当前任务需要完成的步骤"及完成进度，
// 主进程 chat.ipc 解析后转换为 stepProgress，渲染端以悬浮卡片展示。
// 标记对最终用户不可见（会被 strip），仅驱动进度卡片。

// 计划标记：⟪STEP_PLAN⟫步骤1|步骤2|步骤3⟫/STEP_PLAN⟫（在回答开头一次性输出）
// 完成标记：⟪STEP_DONE⟫0⟫/STEP_DONE⟫（索引，从 0 开始；每完成一步输出一条）
export const STEP_PROTOCOL = `## 步骤进度（重要）
在为当前任务开始正式回答前，用下面两个标记汇报你的执行计划与完成进度。这些标记不会被用户看到，仅用于面板展示，请务必按格式输出：

1. 在回答开头（首次正文前）一次性输出计划：
   ⟪STEP_PLAN⟫步骤一标题|步骤二标题|步骤三标题⟫/STEP_PLAN⟫
   （用 | 分隔；若任务仅需一两步也应列 1~3 步，让用户清楚你要做什么）

2. 每实际完成一个步骤后，紧接着输出完成标记（索引从 0 开始）：
   ⟪STEP_DONE⟫0⟫/STEP_DONE⟫
   （按 0,1,2... 顺序推进；仅在你确实完成该步骤后才标记）

计划与完成标记都必须写在正文之外，不要与正文混在同一行；忘打完成标记不会出错，但会错过进度展示。`

const PLAN_OPEN = '⟪STEP_PLAN⟫'
const PLAN_CLOSE = '⟫/STEP_PLAN⟫'
const DONE_OPEN = '⟪STEP_DONE⟫'
const DONE_CLOSE = '⟫/STEP_DONE⟫'

/** 判断 buf[i..] 是否为一个标记开头：完整 open / 未完前缀 / 普通字符 */
function markerOpenKind(buf: string, i: number): 'plan' | 'done' | 'partial' | 'none' {
  if (buf.startsWith(PLAN_OPEN, i)) return 'plan'
  if (buf.startsWith(DONE_OPEN, i)) return 'done'
  const rest = buf.slice(i)
  if (rest.length < PLAN_OPEN.length && PLAN_OPEN.startsWith(rest)) return 'partial'
  if (rest.length < DONE_OPEN.length && DONE_OPEN.startsWith(rest)) return 'partial'
  return 'none'
}

/**
 * 流式步骤标记处理器：跨 chunk 剥离 ⟪STEP_PLAN⟫ / ⟪STEP_DONE⟫ 标记并抽取进度。
 *
 * 模型输出的标记在流式传输中被拆成多个 chunk，单个 chunk 内往往不成完整标记。
 * 此类按 message 维护未消费缓冲区：push(chunk) 时扫描并消费完整标记，
 * 对可能成为标记开头的片段（⟪ 开头的前缀）做"hold-back"——不立即输出，
 * 等后续 chunk 补齐后再决定是标记（剥离）还是普通文本（放行）。
 * 返回剥离标记后的干净文本，plan / doneCount 供 chat.ipc 生成 stepProgress。
 */
export class StepMarkerStream {
  private buf = ''
  plan: string[] = []
  doneCount = 0

  push(chunk: string): string {
    this.buf += chunk
    let out = ''
    let i = 0
    let hold = -1 // >=0 表示从该下标开始保留在缓冲（未闭合/未完成的标记）

    while (i < this.buf.length) {
      const openIdx = this.buf.indexOf('⟪', i)
      if (openIdx === -1) {
        // 之后无任何标记起始符：整段普通文本
        out += this.buf.slice(i)
        i = this.buf.length
        break
      }
      const kind = markerOpenKind(this.buf, openIdx)
      if (kind === 'none') {
        // 这里的 ⟪ 只是普通字符（非 STEP_ 前缀），当作文本前进
        out += this.buf.slice(i, openIdx + 1)
        i = openIdx + 1
        continue
      }
      // 可能是标记：先输出其前的普通文本
      out += this.buf.slice(i, openIdx)
      if (kind === 'partial') {
        // 前缀未完，hold 等待补齐
        hold = openIdx
        break
      }
      const openTok = kind === 'plan' ? PLAN_OPEN : DONE_OPEN
      const closeTok = kind === 'plan' ? PLAN_CLOSE : DONE_CLOSE
      const closeIdx = this.buf.indexOf(closeTok, openIdx + openTok.length)
      if (closeIdx === -1) {
        // open 完整但 close 未到：hold 等待补齐
        hold = openIdx
        break
      }
      const inner = this.buf.slice(openIdx + openTok.length, closeIdx)
      if (kind === 'plan') {
        this.plan = inner.split('|').map((s) => s.trim()).filter(Boolean)
      } else {
        const num = parseInt(inner, 10)
        if (!Number.isNaN(num) && num >= 0 && num + 1 > this.doneCount) this.doneCount = num + 1
      }
      i = closeIdx + closeTok.length
    }

    if (hold !== -1) {
      this.buf = this.buf.slice(hold)
    } else {
      this.buf = ''
    }
    return out
  }

  /** 流结束时调用：返还缓冲内遗留的普通文本（未闭合标记丢弃） */
  flush(): string {
    const leftover = this.buf
    this.buf = ''
    if (leftover.startsWith('⟪')) return ''
    return leftover
  }
}

// ===== 面板指令协议 =====
// Agent 在流式输出时用 ⟪PANEL⟫panelType|k=v|k=v⟫/PANEL⟫ 标记产出"可被右侧 dock 工具面板消费的工件"。
// 主进程 chat.ipc 解析后转换为 panelAction，渲染端 panelCommandStore 路由到对应面板（自动打开+加载数据）。
// 标记对最终用户不可见（流式阶段剥离，cleanText 才持久化），仅驱动面板联动。

const PANEL_OPEN = '⟪PANEL⟫'
const PANEL_CLOSE = '⟫/PANEL⟫'

// 合法的面板类型白名单（防止模型乱输出 panelType）
const PANEL_TYPES = new Set(['browser', 'terminal', 'files', 'kb', 'viewer3d', 'field', 'sql'])

/** 解析 ⟪PANEL⟫ 闭合后的 inner（形如 field|path=results/slice.dat|zone=0）为 PanelCommandPayload */
function parsePanelMarker(inner: string): PanelCommandPayload | null {
  const parts = inner.split('|').map((s) => s.trim()).filter(Boolean)
  if (parts.length < 1) return null
  const panelType = parts[0].toLowerCase()
  if (!PANEL_TYPES.has(panelType)) return null
  const payload: Record<string, unknown> = {}
  for (let k = 1; k < parts.length; k += 1) {
    const eq = parts[k].indexOf('=')
    if (eq <= 0) continue
    const key = parts[k].slice(0, eq).trim()
    const val = parts[k].slice(eq + 1).trim()
    payload[key] = val
  }
  // 根据 panelType 推断默认 action（模型未显式给 action 时）
  const actionGuess =
    panelType === 'browser' ? 'navigate' :
    panelType === 'terminal' ? 'run' :
    panelType === 'kb' ? (payload.query != null ? 'search' : 'open') :
    panelType === 'field' ? 'load' :
    panelType === 'viewer3d' ? 'load' :
    'open'
  const action = String(payload.action ?? actionGuess)
  if (payload.action != null) delete payload.action
  return { panelType, action, payload }
}

/**
 * 流式面板标记处理器：跨 chunk 剥离 ⟪PANEL⟫ ... ⟫/PANEL⟫ 标记并抽取面板指令。
 *
 * 结构与 StepMarkerStream 一致：按 message 维护缓冲，push(chunk) 扫描完整标记并消费，
 * 对 ⟪ 开头的未完前缀做 hold-back，返回剥离标记后的干净文本。
 * commands 累积解析出的面板指令，供 chat.ipc 生成 panelAction 转发。
 */
export class PanelMarkerStream {
  private buf = ''
  commands: PanelCommandPayload[] = []

  push(chunk: string): string {
    this.buf += chunk
    let out = ''
    let i = 0
    let hold = -1

    while (i < this.buf.length) {
      const openIdx = this.buf.indexOf('⟪', i)
      if (openIdx === -1) {
        out += this.buf.slice(i)
        i = this.buf.length
        break
      }
      const isPanel = this.buf.startsWith(PANEL_OPEN, openIdx)
      if (!isPanel) {
        // 这里的 ⟪ 不是 PANEL 标记（可能是 STEP 标记或普通字符），当文本前进
        // 注意：StepMarkerStream 先于本处理器运行，此处通常只剩非 STEP 的 ⟪；
        // 即便残留，按普通字符放行即可，不会误吞
        out += this.buf.slice(i, openIdx + 1)
        i = openIdx + 1
        continue
      }
      // 可能是 PANEL 标记：先输出其前的普通文本
      out += this.buf.slice(i, openIdx)
      const rest = this.buf.slice(openIdx)
      // open 未完前缀：hold 等补齐
      if (rest.length < PANEL_OPEN.length && PANEL_OPEN.startsWith(rest)) {
        hold = openIdx
        break
      }
      const closeIdx = this.buf.indexOf(PANEL_CLOSE, openIdx + PANEL_OPEN.length)
      if (closeIdx === -1) {
        // open 完整但 close 未到：hold 等待补齐
        hold = openIdx
        break
      }
      const inner = this.buf.slice(openIdx + PANEL_OPEN.length, closeIdx)
      const cmd = parsePanelMarker(inner)
      if (cmd) this.commands.push(cmd)
      i = closeIdx + PANEL_CLOSE.length
    }

    if (hold !== -1) {
      this.buf = this.buf.slice(hold)
    } else {
      this.buf = ''
    }
    return out
  }

  /** 流结束时调用：返还缓冲内遗留的普通文本（未闭合标记丢弃） */
  flush(): string {
    const leftover = this.buf
    this.buf = ''
    if (leftover.startsWith('⟪')) return ''
    return leftover
  }
}

// 面板指令协议说明（注入到产出面板工件的 agent 的 system prompt 末尾）
export const PANEL_ACTION_PROTOCOL = `## 面板联动（可选，仅在产出可被工具面板消费的工件时输出）
当你在分析中产出了可以由右侧工具面板直接加载/展示的工件（如仿真结果文件、要打开的网页、要检索的知识库关键词），用下面标记通知系统自动打开对应面板并加载，用户无需手动操作。

### 标记格式（写在正文末尾，可多条）
⟪PANEL⟫field|path=results/slice.dat⟫/PANEL⟫
⟪PANEL⟫browser|url=https://example.com⟫/PANEL⟫
⟪PANEL⟫kb|query=翼型失速特性⟫/PANEL⟫
⟪PANEL⟫viewer3d|path=assets/wing.stl⟫/PANEL⟫

### 格式说明
- 第一段：面板类型（field 仿真结果 | browser 浏览器 | kb 知识库 | viewer3d 三维模型 | files 文件 | terminal 终端 | sql 数据）
- 后续段：key=value，用 | 分隔
  - field/viewer3d/files/terminal：path=相对路径（相对于文件工作空间根目录）
  - browser：url=完整网址
  - kb：query=检索关键词（驱动知识库面板搜索）
- 标记不会展示给最终用户，会由系统剥离后驱动面板

### 使用时机
- 你生成了/指向了仿真结果文件（.dat/.plt）→ field
- 你建议查看某外部网页/标准文档 → browser
- 你提到应检索某知识库主题 → kb
- 你指向了三维模型文件 → viewer3d
仅在确实产出工件时输出，不要凭空输出路径或 URL。`

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
  /** 子类置 true：在 system prompt 末尾注入 PANEL_ACTION_PROTOCOL，让其产出 ⟪PANEL⟫ 标记驱动右侧 dock 面板 */
  protected emitsPanelCommands = false
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
    const { skills } = resolveEffectiveSkills(this.config.type, task, context?.forcedSkillIds)
    const skillsSection = skills.length > 0 ? `\n\n${formatSkillsForPrompt(skills)}` : ''
    const panelSection = this.emitsPanelCommands ? `\n\n${PANEL_ACTION_PROTOCOL}` : ''
    return `${this.systemPrompt}\n\n${AGENT_MESSAGING_PROTOCOL}${skillsSection}${panelSection}\n\n${STEP_PROTOCOL}`
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
    // 先发射"技能已触发"提示（强制注入 + 关键词匹配），两种引擎路径（Pi/DeepSeek）共用
    const { triggers } = resolveEffectiveSkills(this.config.type, task, context?.forcedSkillIds)
    if (triggers.length > 0) {
      yield { messageId, agentType: this.config.type, content: '', skillTriggers: triggers, isComplete: false }
    }

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
      signal: context.signal,
      securityContext: {
        agentType: this.config.type,
        agentName: this.config.name,
        agentColor: this.config.color,
        conversationId: context.conversationId,
        messageId,
        setState: (s) => this.setState(s)
      }
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
