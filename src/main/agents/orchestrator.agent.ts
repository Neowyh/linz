import { v4 as uuidv4 } from 'uuid'
import { createChatModel } from '../llm'
import { streamChat } from '../llm/stream-handler'
import { AgentStateMachine } from './agent-state-machine'
import { agentRegistry } from './agent-registry'
import { agentMessageBus } from './agent-message-bus'
import { ORCHESTRATOR_SYSTEM_PROMPT } from './prompts/orchestrator.system'
import { searchKnowledgeBase, formatRagContext, hybridSearch } from '../ipc/knowledge.ipc'
import { getCustomKeywords, getCustomSubtaskPrefix, getBuiltinAgentKeywords, getBuiltinSubtaskPrefix } from './custom-agents.service'
import { formatSkillsForPrompt, resolveEffectiveSkills } from './agent-skills.service'
import type { IAgent, AgentConfig, AgentState, StreamChunk, AgentContext, AgentStatusData, AgentType, AgentMessage, AgentOverrideConfig } from './base.agent'
import { buildChatHistory } from './base.agent'
import { HumanMessage, AIMessage } from '@langchain/core/messages'

const KEYWORD_MAP: Record<string, AgentType> = {
  // 气动
  '翼型': 'aero', '升力': 'aero', '阻力': 'aero', '升阻比': 'aero', '气动': 'aero',
  '马赫数': 'aero', '迎角': 'aero', '后掠角': 'aero', '展弦比': 'aero', 'CFD': 'aero',
  '翼展': 'aero', 'NACA': 'aero', '机翼': 'aero', '巡航速度': 'aero',
  '失速': 'aero', '俯仰力矩': 'aero', '压力分布': 'aero', '边界层': 'aero',
  '湍流': 'aero', '雷诺数': 'aero', '螺旋桨': 'aero', '涡流': 'aero', '激波': 'aero',
  'cfd': 'aero', 'airfoil': 'aero', 'lift': 'aero', 'drag': 'aero', 'wing': 'aero',
  // 结构
  '结构': 'structural', '强度': 'structural', '刚度': 'structural', '材料': 'structural',
  '疲劳': 'structural', '载荷': 'structural', '复合材料': 'structural', '铝合金': 'structural',
  '铺层': 'structural', '连接件': 'structural', '有限元': 'structural', 'FEM': 'structural',
  '梁截面': 'structural', '拓扑优化': 'structural',
  // 推进
  '推进': 'propulsion', '发动机': 'propulsion', '推力': 'propulsion', '燃油': 'propulsion',
  '涡扇': 'propulsion', '活塞': 'propulsion', '电机': 'propulsion', '推重比': 'propulsion',
  '桨盘': 'propulsion', '能量': 'propulsion', '电池': 'propulsion', '耗油率': 'propulsion',
  // 航电
  '航电': 'avionics', '飞控': 'avionics', '传感器': 'avionics', '通信': 'avionics',
  '导航': 'avionics', 'GPS': 'avionics', 'IMU': 'avionics', '电气': 'avionics',
  '电磁': 'avionics', 'EMC': 'avionics', '天线': 'avionics',
  // 仿真
  '仿真': 'simulation', 'OpenFOAM': 'simulation', 'SU2': 'simulation', 'XFOIL': 'simulation',
  '网格': 'simulation', '求解器': 'simulation', 'RANS': 'simulation', 'LES': 'simulation',
  '后处理': 'simulation', '前处理': 'simulation',
  // 文档
  '报告': 'documentation', 'PPT': 'documentation', '文档': 'documentation', 'GJB': 'documentation',
  '技术报告': 'documentation', '设计评审': 'documentation', '综述': 'documentation',
  // 检索
  '文献': 'retriever', '标准': 'retriever', '规范': 'retriever', '案例': 'retriever',
  '参考': 'retriever', '查': 'retriever', '调研': 'retriever'
}

function identifyAgents(task: string): AgentType[] {
  const taskLower = task.toLowerCase()
  const agentSet = new Set<AgentType>()

  // 1. Start with hardcoded KEYWORD_MAP
  const mergedMap = new Map<string, AgentType>()
  for (const [keyword, agentType] of Object.entries(KEYWORD_MAP)) {
    mergedMap.set(keyword.toLowerCase(), agentType)
  }

  // 2. Override with built-in agent keywords from DB
  try {
    const builtinKeywords = getBuiltinAgentKeywords()
    for (const [keyword, agentType] of Object.entries(builtinKeywords)) {
      if (!mergedMap.has(keyword.toLowerCase())) {
        mergedMap.set(keyword.toLowerCase(), agentType)
      }
    }
  } catch {
    // DB not available, use hardcoded keywords only
  }

  // 3. Add custom agent keywords (don't override built-in)
  try {
    const customKeywords = getCustomKeywords()
    for (const [keyword, agentType] of Object.entries(customKeywords)) {
      if (!mergedMap.has(keyword.toLowerCase())) {
        mergedMap.set(keyword.toLowerCase(), agentType as AgentType)
      }
    }
  } catch {
    // ignore
  }

  // Match task against keywords
  for (const [keyword, agentType] of mergedMap) {
    if (taskLower.includes(keyword)) {
      agentSet.add(agentType)
    }
  }

  return Array.from(agentSet)
}

// 解析子 Agent 输出中的结构化消息标记
const AGENT_MSG_PATTERN = /<<<AGENT_MSG>>>\s*([\s\S]*?)<<<\/AGENT_MSG>>>/g

function parseAgentMessages(text: string, fromAgent: AgentType): AgentMessage[] {
  const messages: AgentMessage[] = []
  let match: RegExpExecArray | null
  // Reset regex state since it's a global regex reused across calls
  AGENT_MSG_PATTERN.lastIndex = 0
  while ((match = AGENT_MSG_PATTERN.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1])
      messages.push({
        id: uuidv4(),
        fromAgent,
        toAgent: parsed.toAgent || 'orchestrator',
        type: parsed.type || 'notification',
        content: parsed.content || '',
        params: parsed.params,
        confidence: parsed.confidence,
        timestamp: Date.now()
      })
    } catch {
      // Skip malformed messages
    }
  }
  return messages
}

// 格式化 agent 的消息收发摘要，作为可见 chunk 追加到 agent 气泡
function formatMessageSummary(sent: AgentMessage[], received: AgentMessage[]): string {
  if (sent.length === 0 && received.length === 0) return ''
  const lines: string[] = []
  for (const m of sent) {
    const conf = typeof m.confidence === 'number' ? `, 置信度 ${m.confidence}` : ''
    lines.push(`- → ${m.toAgent} (${m.type}${conf}): ${m.content}`)
  }
  for (const m of received) {
    const conf = typeof m.confidence === 'number' ? `, 置信度 ${m.confidence}` : ''
    lines.push(`- ← ${m.fromAgent} (${m.type}${conf}): ${m.content}`)
  }
  return `\n\n---\n\n📨 **消息收发**:\n${lines.join('\n')}\n`
}

// 最大并发 Agent 数
const MAX_CONCURRENT_AGENTS = 3
// 最大协商轮次（round 1 + 1 次消息驱动精化）
const MAX_ROUNDS = 2

// 解析用户消息开头的 @agent-id 或 @agent-name 前缀
// 形如 "@aero 分析这个翼型" / "@气动 Agent 帮我看一下" / "@agent-custom-xxx 任务"
// 支持中文名、英文名、id；返回 { mention, strippedTask, restTask } 或 null
const MENTION_PREFIX_PATTERN = /^@([^\s@]+)\s+([\s\S]+)$/

interface ParsedMention {
  mention: string  // @ 后的原始 token（id 或 name）
  strippedTask: string  // 去掉 @mention 后的任务文本
}

function parseMention(task: string): ParsedMention | null {
  if (!task) return null
  const trimmed = task.trimStart()
  if (!trimmed.startsWith('@')) return null
  const match = MENTION_PREFIX_PATTERN.exec(trimmed)
  if (!match) return null
  const mention = match[1].trim()
  const strippedTask = match[2].trim()
  if (!mention || !strippedTask) return null
  return { mention, strippedTask }
}

// 简易并发限制器（替代 p-limit，避免 ESM 兼容问题）
function createLimit(concurrency: number) {
  let activeCount = 0
  const queue: (() => void)[] = []

  const next = () => {
    if (queue.length > 0 && activeCount < concurrency) {
      activeCount++
      queue.shift()!()
    }
  }

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const run = () => {
        fn().then(
          (result) => { activeCount--; resolve(result); next() },
          (err) => { activeCount--; reject(err); next() }
        )
      }
      if (activeCount < concurrency) {
        activeCount++
        run()
      } else {
        queue.push(run)
      }
    })
}

export class OrchestratorAgent implements IAgent {
  readonly config: AgentConfig
  private stateMachine = new AgentStateMachine()
  private messageQueue: AgentMessage[] = []
  private systemPrompt: string

  constructor(overrides?: AgentOverrideConfig) {
    this.config = {
      type: 'orchestrator',
      name: overrides?.name ?? '协调 Agent',
      color: overrides?.color ?? '#722ED1',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/orchestrator.svg',
      delegatesTo: overrides?.delegatesTo ?? ['aero','structural','propulsion','avionics','simulation','documentation','retriever'],
      engine: overrides?.engine ?? 'deepseek'
    }
    this.systemPrompt = overrides?.systemPrompt ?? ORCHESTRATOR_SYSTEM_PROMPT
  }

  getState(): AgentState { return this.stateMachine.getState() }
  setState(state: AgentState): void { this.stateMachine.transition(state) }
  forceReset(): void { this.stateMachine.reset() }

  sendMessage(msg: AgentMessage): void {
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

  getAvailableTools(_context?: AgentContext): any[] {
    return []
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      // === @mention 直接路由（优先检查，避免广播 orchestrator 的 thinking 状态） ===
      // 若消息以 "@agent-id" 或 "@agent-name" 开头，跳过关键词匹配和并发调度，
      // 直接委派给目标 agent 处理整条消息（不并发调用其他 agent，不显示协调器）
      const mention = parseMention(task)

      // UI 选择的 agent（含 'general'）都走直接路由，不显示协调器状态
      // selectedAgent 缺省时默认 'general'
      const selected = context.selectedAgent || 'general'
      const uiSelectedAgent = agentRegistry.get(selected)

      if (mention) {
        const targetAgent = agentRegistry.findByMention(mention.mention)
        if (targetAgent) {
          // 直接委派给目标 agent，不输出任何 orchestrator chunk
          // 目标 agent 自己的 isComplete:true (agentMessageId) 会完成持久化；
          // 生成器结束后 chat.ipc.ts 会发送 chat:streamEnd 通知渲染端流结束
          yield* this.runDirectMention(targetAgent, mention.strippedTask, context, messageId)
          return
        }
        // 未找到匹配的 agent：先广播 orchestrator thinking，再提示并回退正常流程
        this.stateMachine.transition('thinking')
        yield {
          messageId, agentType: 'orchestrator', content: '',
          statusChange: { agentType: 'orchestrator', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '分析任务...' },
          isComplete: false
        }
        yield {
          messageId, agentType: 'orchestrator',
          content: `> ⚠️ 未找到 Agent "@${mention.mention}"，已按正常流程处理。\n\n`,
          isComplete: false
        }
        // 关键：剥离 @mention 前缀，避免污染后续关键词匹配和子 Agent 的 LLM 上下文
        task = mention.strippedTask
      } else if (context.dispatchMode === 'collaborative') {
        // 协同调度模式：广播 thinking，随后按关键词并发调度多个专业 Agent
        this.stateMachine.transition('thinking')
        yield { messageId, agentType: 'orchestrator', content: '', statusChange: { agentType: 'orchestrator', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '分析任务...' }, isComplete: false }
      } else {
        // 单 Agent 模式：直连目标 Agent（默认 general），不显示协调器、不并发调度
        // 下拉框已移除 orchestrator 项，selected 不会是 orchestrator；此处仍做防护避免递归
        const target = selected === 'orchestrator' ? (agentRegistry.get('general') || uiSelectedAgent) : uiSelectedAgent
        if (target) {
          yield* this.runDirectMention(target, task, context, messageId)
          return
        }
        // 目标 Agent 不存在（异常）：广播 thinking 后回退到 general 直接回答
        this.stateMachine.transition('thinking')
        yield { messageId, agentType: 'orchestrator', content: '', statusChange: { agentType: 'orchestrator', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '分析任务...' }, isComplete: false }
      }

      // 协同调度模式：按关键词匹配需要调度的专业 Agent；单 Agent 模式不会走到这里（已 return）
      // @mention 未命中时剥离前缀后也会落到这里，按当前 dispatchMode 处理
      const neededAgents: AgentType[] = context.dispatchMode === 'collaborative' ? identifyAgents(task) : []

      // 动态构建系统提示词：基础提示词 + 当前可用 Agent 列表 + 生效技能（强制注入优先）
      const availableAgents = agentRegistry.getAllStates()
        .filter(s => s.agentType !== 'orchestrator')
        .map(s => `- **${s.name}** (${s.agentType})`)
        .join('\n')
      const { skills: orchestratorSkills, triggers: orchestratorSkillTriggers } = resolveEffectiveSkills('orchestrator', task, context.forcedSkillIds)
      if (orchestratorSkillTriggers.length > 0) {
        yield { messageId, agentType: 'orchestrator', content: '', skillTriggers: orchestratorSkillTriggers, isComplete: false }
      }
      const dynamicSystemPrompt = (() => {
        const base = `${this.systemPrompt}\n\n## 当前可调度的专业 Agent\n${availableAgents || '- （暂无可用 Agent）'}`
        return orchestratorSkills.length > 0 ? `${base}\n\n${formatSkillsForPrompt(orchestratorSkills)}` : base
      })()
      // RAG: 检索知识库相关片段（优先使用混合检索）
      let ragContext: string | undefined
      try {
        const searchResults = await hybridSearch(task, { limit: 5 })
        if (searchResults.length > 0) {
          ragContext = formatRagContext(searchResults)
        }
      } catch (err) {
        // 混合检索失败时回退到 BM25
        console.warn('[Orchestrator] Hybrid search failed, falling back to BM25:', err)
        try {
          const bm25Results = searchKnowledgeBase(task, { limit: 5 })
          if (bm25Results.length > 0) {
            ragContext = formatRagContext(bm25Results)
          }
        } catch {
          // BM25 也失败则忽略
        }
      }

      this.stateMachine.transition('working')
      yield { messageId, agentType: 'orchestrator', content: '', statusChange: { agentType: 'orchestrator', name: this.config.name, color: this.config.color, state: 'working', currentTask: neededAgents.length > 0 ? `调度${neededAgents.length}个专业Agent` : '直接回答' }, isComplete: false }

      // ⚠️ 已知引擎割裂（Phase A 共存模式）：协同模式下 orchestrator 自身走 DeepSeek/LangChain
      // （createChatModel + streamChat），而被调度的子 agent 走 Pi 引擎（runWithPi）。
      // 当 DeepSeek 不可用、Ollama 启用时，两条路径各自独立 fallback 到 Ollama：
      //   orchestrator → LangChain createOllamaModel
      //   子 agent → Pi getOllamaModelContext
      // 二者可能落到不同 Ollama 模型实例或一个成功一个失败，语义割裂。
      // Phase B 统一切到 Pi 引擎后此割裂消失，届时移除本注释与 DeepSeek 路径。
      const llm = createChatModel()

      // 构建对话历史（保留 agent_type 元数据）
      const chatHistory = buildChatHistory(context)

      if (neededAgents.length > 0) {
        // 先输出协调 Agent 的分析
        const agentNames = neededAgents.map((t) => {
          const a = agentRegistry.get(t)
          return a ? a.config.name : t
        })

        const orchestrationPrompt = `用户提出了以下飞行器设计任务：

"${task}"

经过分析，此任务涉及以下专业领域：${agentNames.join('、')}
我将调度这些专业 Agent 协同完成。请简要说明你的分析思路和调度计划，然后开始分析。`

        const orchestratorStream = streamChat(llm, {
          systemPrompt: dynamicSystemPrompt,
          userMessage: orchestrationPrompt,
          chatHistory,
          ragContext,
          signal: context.signal
        })

        for await (const chunk of orchestratorStream) {
          if (context.signal.aborted) break
          if (typeof chunk === 'string') {
            yield { messageId, agentType: 'orchestrator', content: chunk, isComplete: false }
          }
        }

        if (context.signal.aborted) {
          yield { messageId, agentType: 'orchestrator', content: '', isComplete: true }
          return
        }

        // 并发调度专业 Agent（多轮协商）
        const prioritizedAgents = agentRegistry.getAgentsByPriority(neededAgents)

        if (prioritizedAgents.length === 1) {
          yield* this.runSingleAgent(prioritizedAgents[0], task, context, messageId, ragContext)
          // 单 agent 路径：路由其发送的消息到目标队列，但不触发 round 2
          this.routeAgentMessages()
          // flush 未处理 request，避免污染下一轮用户对话
          yield* this.flushUnprocessedRequests(messageId)
        } else {
          // 多轮协商循环：round 1 跑所有匹配的 agent → 路由消息 →
          // round 2 跑收到 request 类消息的 agent → 最多 MAX_ROUNDS 轮
          let round = 0
          let agentsToRun = prioritizedAgents
          while (agentsToRun.length > 0 && round < MAX_ROUNDS) {
            round++
            if (round > 1) {
              yield {
                messageId, agentType: 'orchestrator',
                content: `\n\n---\n\n### 协商第 ${round} 轮\n\n收到请求的 Agent 继续分析...\n\n`,
                isComplete: false
              }
            }
            yield* this.runAgentsConcurrently(agentsToRun, task, context, messageId, ragContext)
            if (context.signal.aborted) break
            if (round >= MAX_ROUNDS) break
            // 路由本轮消息到 recipient 队列
            this.routeAgentMessages()
            // 找出收到 request 类消息的 agent 作为下一轮候选
            const allAgents = agentRegistry.getAllStates()
              .filter(s => s.agentType !== 'orchestrator')
              .map(s => agentRegistry.get(s.agentType))
              .filter((a): a is IAgent => a !== undefined)
            const nextTypes = allAgents
              .filter(a => a.getPendingMessages().some(m => m.type === 'request'))
              .map(a => a.config.type)
            agentsToRun = nextTypes.length > 0 ? agentRegistry.getAgentsByPriority(nextTypes) : []
          }
          // 路由最后一轮的消息（loop 在 break 前未路由）
          this.routeAgentMessages()
          // flush 仍未处理的 request 消息
          yield* this.flushUnprocessedRequests(messageId)
        }

        // 汇总
        this.stateMachine.transition('completed')
        yield {
          messageId, agentType: 'orchestrator',
          content: '\n\n---\n\n**任务已完成，以上为各专业 Agent 的协同分析结果。**',
          statusChange: { agentType: 'orchestrator', name: this.config.name, color: this.config.color, state: 'completed' },
          isComplete: false
        }
      } else {
        // 未匹配专业关键词：默认路由到普通对话 Agent
        const generalAgent = agentRegistry.get('general')
        if (generalAgent) {
          yield* this.runSingleAgent(generalAgent, task, context, messageId, ragContext)
          this.routeAgentMessages()
          yield* this.flushUnprocessedRequests(messageId)
        } else {
          // general agent 未注册（异常情况），回退到协调器直接回答
          const directStream = streamChat(llm, {
            systemPrompt: dynamicSystemPrompt,
            userMessage: task,
            chatHistory,
            ragContext,
            signal: context.signal
          })

          for await (const chunk of directStream) {
            if (context.signal.aborted) break
            if (typeof chunk === 'string') {
              yield { messageId, agentType: 'orchestrator', content: chunk, isComplete: false }
            }
          }

          if (context.signal.aborted) {
            yield { messageId, agentType: 'orchestrator', content: '', isComplete: true }
            return
          }

          this.stateMachine.transition('completed')
        }
      }

      yield { messageId, agentType: 'orchestrator', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }

  // 直接路由：用户以 @agent 形式指定目标 agent，跳过关键词匹配与并发调度，
  // 单独委派给该 agent 处理整条消息（仍传递 RAG 上下文与 chatHistory）
  // 不输出任何 orchestrator 状态/气泡，让目标 agent 完全接管 UI
  private async *runDirectMention(
    agent: IAgent,
    task: string,
    context: AgentContext,
    baseMessageId: string
  ): AsyncGenerator<StreamChunk> {
    const agentMessageId = `${baseMessageId}-${agent.config.type}`

    // orchestrator 内部状态：先 thinking 再 working（state machine 不允许 idle→working 直接跳转）
    // 不 yield statusChange，避免 UI 显示协调器
    this.stateMachine.transition('thinking')
    this.stateMachine.transition('working')

    // RAG: 仍为目标 agent 检索知识库（与正常调度路径一致）
    let ragContext: string | undefined
    try {
      const searchResults = await hybridSearch(task, { limit: 5 })
      if (searchResults.length > 0) {
        ragContext = formatRagContext(searchResults)
      }
    } catch (err) {
      console.warn('[Orchestrator] Direct mention hybrid search failed:', err)
      try {
        const bm25Results = searchKnowledgeBase(task, { limit: 5 })
        if (bm25Results.length > 0) {
          ragContext = formatRagContext(bm25Results)
        }
      } catch {
        // ignore
      }
    }

    // 先让目标 agent 进入 thinking 状态（statusChange 用目标 agent 类型，content 留空）
    agent.setState('thinking')
    yield {
      messageId: agentMessageId, agentType: agent.config.type,
      content: '',
      statusChange: { agentType: agent.config.type, name: agent.config.name, color: agent.config.color, state: 'thinking', currentTask: '直接处理用户请求...' },
      isComplete: false
    }

    // 直连路由本质是单 Agent 语义：强制 dispatchMode='single'，使目标 Agent 不注入 delegate 工具
    // （协同模式下用 @aero 临时覆盖时，aero 也按单 Agent 跑，不串出其他 Agent）
    const agentContext: AgentContext = { ...context, ragContext, dispatchMode: 'single' }

    try {
      for await (const chunk of agent.run(task, agentContext)) {
        if (context.signal.aborted) break
        // 原样转发目标 agent 的 chunk，仅重写 messageId 以保持流一致性
        yield { ...chunk, messageId: agentMessageId }
      }
    } catch (err) {
      // 目标 agent 的 finally 已将 registry 重置为 idle；这里显式置为 error，
      // 使 registry 与即将 yield 的 error statusChange 一致（UI 与 registry 对齐）
      agent.setState('error')
      yield {
        messageId: agentMessageId,
        agentType: agent.config.type,
        content: `\n\n> ${agent.config.name} 执行出错: ${err instanceof Error ? err.message : String(err)}\n\n`,
        statusChange: { agentType: agent.config.type, name: agent.config.name, color: agent.config.color, state: 'error' },
        isComplete: false
      }
    }

    // 标记 orchestrator 内部完成（不 yield statusChange，避免 UI 显示协调器完成状态）
    this.stateMachine.transition('completed')
  }

  // 串行执行单个 Agent
  private async *runSingleAgent(
    agent: IAgent,
    task: string,
    context: AgentContext,
    baseMessageId: string,
    ragContext?: string
  ): AsyncGenerator<StreamChunk> {
    const agentMessageId = `${baseMessageId}-${agent.config.type}`
    const receivedBefore = agent.getPendingMessages()

    agent.setState('thinking')
    yield {
      messageId: baseMessageId, agentType: 'orchestrator',
      content: `\n\n---\n\n### ${agent.config.icon} ${agent.config.name} 分析中...\n\n`,
      statusChange: { agentType: agent.config.type, name: agent.config.name, color: agent.config.color, state: 'thinking' },
      isComplete: false
    }

    const agentContext: AgentContext = { ...context, ragContext }
    const subtask = buildSubtask(agent.config.type, task)
    let accumulated = ''
    try {
      for await (const chunk of agent.run(subtask, agentContext)) {
        if (context.signal.aborted) break
        if (chunk.content) accumulated += chunk.content
        yield { ...chunk, messageId: agentMessageId }
      }
    } catch (err) {
      // 同 runDirectMention：对齐 registry 与 UI 的 error 状态
      agent.setState('error')
      yield {
        messageId: agentMessageId,
        agentType: agent.config.type,
        content: `\n\n> ${agent.config.name} 执行出错: ${err instanceof Error ? err.message : String(err)}\n\n`,
        statusChange: { agentType: agent.config.type, name: agent.config.name, color: agent.config.color, state: 'error' },
        isComplete: false
      }
    }

    // 解析 agent 输出中的结构化消息并发布到 bus
    const sent = parseAgentMessages(accumulated, agent.config.type as AgentType)
    for (const msg of sent) {
      agentMessageBus.publish(msg)
      // 同步转发到渲染端（办公室可视化用），content 留空避免聊天框重复显示
      yield { messageId: agentMessageId, agentType: agent.config.type, content: '', agentMessage: msg, isComplete: false }
    }

    // 收发摘要
    const summary = formatMessageSummary(sent, receivedBefore)
    if (summary) {
      yield { messageId: agentMessageId, agentType: agent.config.type, content: summary, isComplete: false }
    }
  }

  // 并发执行多个 Agent，最大并发数 3
  private async *runAgentsConcurrently(
    agents: IAgent[],
    task: string,
    context: AgentContext,
    baseMessageId: string,
    ragContext?: string
  ): AsyncGenerator<StreamChunk> {
    const limit = createLimit(MAX_CONCURRENT_AGENTS)

    // 本轮每个 agent 收到的消息快照（在 run 之前捕获，run 内会清空队列）
    const receivedSnapshots = new Map<string, AgentMessage[]>()
    for (const agent of agents) {
      receivedSnapshots.set(agent.config.type, agent.getPendingMessages())
    }

    // Yield status headers for all agents first
    for (const agent of agents) {
      agent.setState('thinking')
      yield {
        messageId: baseMessageId, agentType: 'orchestrator',
        content: `\n\n---\n\n### ${agent.config.icon} ${agent.config.name} 分析中...\n\n`,
        statusChange: { agentType: agent.config.type, name: agent.config.name, color: agent.config.color, state: 'thinking' },
        isComplete: false
      }
    }

    // Collect chunks from concurrent agents via a shared queue
    const chunkQueue: StreamChunk[] = []
    let resolveChunk: (() => void) | null = null
    let allDone = false

    const enqueueChunk = (chunk: StreamChunk) => {
      chunkQueue.push(chunk)
      if (resolveChunk) {
        resolveChunk()
        resolveChunk = null
      }
    }

    const waitForChunk = (): Promise<void> => {
      if (chunkQueue.length > 0 || allDone || context.signal.aborted) return Promise.resolve()
      return new Promise<void>((resolve) => {
        resolveChunk = resolve
        // abort 时立即唤醒消费者，避免阻塞在空队列上
        if (context.signal.aborted) {
          resolveChunk()
          resolveChunk = null
          return
        }
        context.signal.addEventListener(
          'abort',
          () => {
            if (resolveChunk) {
              resolveChunk()
              resolveChunk = null
            }
          },
          { once: true }
        )
      })
    }

    // 每个并发任务的累积文本，用于结束后解析 markers
    // Launch all agents concurrently via pLimit
    const agentTasks = agents.map((agent) =>
      limit(async () => {
        const agentMessageId = `${baseMessageId}-${agent.config.type}`
        const subtask = buildSubtask(agent.config.type, task)
        const agentContext: AgentContext = { ...context, ragContext }
        let accumulated = ''

        try {
          for await (const chunk of agent.run(subtask, agentContext)) {
            if (context.signal.aborted) break
            if (chunk.content) accumulated += chunk.content
            enqueueChunk({ ...chunk, messageId: agentMessageId })
          }
        } catch (err) {
          // 同步 registry 至 error，与 UI statusChange 对齐
          agent.setState('error')
          enqueueChunk({
            messageId: agentMessageId,
            agentType: agent.config.type,
            content: `\n\n> ${agent.config.name} 执行出错: ${err instanceof Error ? err.message : String(err)}\n\n`,
            statusChange: { agentType: agent.config.type, name: agent.config.name, color: agent.config.color, state: 'error' },
            isComplete: false
          })
        }

        // 解析并发送结构化消息
        const sent = parseAgentMessages(accumulated, agent.config.type as AgentType)
        for (const msg of sent) {
          agentMessageBus.publish(msg)
          // 同步转发到渲染端（办公室可视化用）
          enqueueChunk({
            messageId: agentMessageId,
            agentType: agent.config.type,
            content: '',
            agentMessage: msg,
            isComplete: false
          })
        }

        // 收发摘要 chunk
        const received = receivedSnapshots.get(agent.config.type) || []
        const summary = formatMessageSummary(sent, received)
        if (summary) {
          enqueueChunk({
            messageId: agentMessageId,
            agentType: agent.config.type,
            content: summary,
            isComplete: false
          })
        }
      })
    )

    // Wait for all agents in the background
    Promise.allSettled(agentTasks).then(() => {
      allDone = true
      if (resolveChunk) {
        resolveChunk()
        resolveChunk = null
      }
    })

    // Yield chunks as they arrive
    while (!allDone || chunkQueue.length > 0) {
      if (context.signal.aborted) break
      await waitForChunk()
      while (chunkQueue.length > 0) {
        const chunk = chunkQueue.shift()!
        yield chunk
      }
    }
  }

  // 路由 Agent 间的结构化消息
  private routeAgentMessages(): void {
    const allAgentTypes = agentRegistry.getAllStates()
      .map(s => s.agentType as AgentType)
      .filter(t => t !== 'orchestrator')

    for (const agentType of allAgentTypes) {
      const agent = agentRegistry.get(agentType)
      if (!agent) continue

      const messages = agentMessageBus.getMessagesFor(agentType)
      for (const msg of messages) {
        agent.receiveMessage(msg)
      }
    }

    agentMessageBus.clearAll()
  }

  // flush 仍未处理的 request 类消息：发出告警并清空所有 agent 队列
  // 在多轮协商结束后调用，避免遗留消息污染下一轮用户对话
  private async *flushUnprocessedRequests(messageId: string): AsyncGenerator<StreamChunk> {
    const allAgents = agentRegistry.getAllStates()
      .filter(s => s.agentType !== 'orchestrator')
      .map(s => agentRegistry.get(s.agentType))
      .filter((a): a is IAgent => a !== undefined)

    const unprocessed: AgentMessage[] = []
    for (const a of allAgents) {
      const pending = a.getPendingMessages()
      unprocessed.push(...pending.filter(m => m.type === 'request'))
      a.clearPendingMessages()
    }

    if (unprocessed.length > 0) {
      const lines = unprocessed.map(m => `- ${m.fromAgent} → ${m.toAgent}: ${m.content}`).join('\n')
      yield {
        messageId, agentType: 'orchestrator',
        content: `\n\n---\n\n⚠️ **达到最大协商轮次(${MAX_ROUNDS})，以下 request 消息未被处理**:\n${lines}\n`,
        isComplete: false
      }
    }
  }
}

function buildSubtask(agentType: AgentType, originalTask: string): string {
  // Check DB override first
  try {
    const prefix = getBuiltinSubtaskPrefix(agentType)
    if (prefix !== undefined) return prefix + originalTask
  } catch {
    // DB not available
  }

  // Fall back to hardcoded prefix
  const prefix: Record<string, string> = {
    orchestrator: '',
    aero: '作为气动分析工程师，请对以下飞行器设计任务进行气动分析：\n\n',
    structural: '作为结构设计工程师，请对以下飞行器设计任务进行结构分析：\n\n',
    propulsion: '作为推进系统工程师，请对以下飞行器设计任务进行推进系统分析：\n\n',
    avionics: '作为航电系统工程师，请对以下飞行器设计任务进行航电系统分析：\n\n',
    simulation: '作为仿真工程师，请对以下飞行器设计任务提供仿真方案建议：\n\n',
    documentation: '作为文档工程师，请根据以下飞行器设计任务生成技术文档：\n\n',
    retriever: '作为知识检索专家，请针对以下飞行器设计任务进行相关知识检索与整理：\n\n'
  }
  if (prefix[agentType] !== undefined) return prefix[agentType] + originalTask
  try {
    const customPrefix = getCustomSubtaskPrefix(agentType)
    return (customPrefix || '') + originalTask
  } catch {
    return originalTask
  }
}
