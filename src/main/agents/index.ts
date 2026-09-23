import { OrchestratorAgent } from './orchestrator.agent'
import { GeneralAgent } from './general.agent'
import { AeroAgent } from './aero.agent'
import { StructuralAgent } from './structural.agent'
import { PropulsionAgent } from './propulsion.agent'
import { AvionicsAgent } from './avionics.agent'
import { SimulationAgent } from './simulation.agent'
import { DocumentationAgent } from './documentation.agent'
import { RetrieverAgent } from './retriever.agent'
import { agentRegistry } from './agent-registry'
import { getBuiltinAgentOverrides, registerCustomAgentsFromDB, registerBuiltinDynamicAgents } from './custom-agents.service'
import { registerBuiltinTools } from './tools'
import type { StreamChunk, AgentContext, AgentOverrideConfig } from './base.agent'
import { getLLMConfig, compressContext } from '../llm'
import { getAppConfig } from '../store/app-config'
import { getMessagesRepo, getConversationsRepo } from '../database'

let agentEngine: AgentEngine | null = null

// 初始化时立即注册所有 Agent 到 registry（不依赖 API Key）
export function registerAllAgents(): void {
  if (agentRegistry.get('orchestrator')) return // 已注册

  // 先把内置工具注册到 ToolRegistry（供 resolveToolsByNames / IPC availableTools 使用）
  registerBuiltinTools()

  // Load built-in agent overrides from DB
  let overrides: Record<string, AgentOverrideConfig> = {}
  try {
    overrides = getBuiltinAgentOverrides()
  } catch (err) {
    console.warn('[Agents] Failed to load built-in agent overrides:', err)
  }

  agentRegistry.register(new OrchestratorAgent(overrides['orchestrator']))
  agentRegistry.register(new GeneralAgent(overrides['general']))
  agentRegistry.register(new AeroAgent(overrides['aero']))
  agentRegistry.register(new StructuralAgent(overrides['structural']))
  agentRegistry.register(new PropulsionAgent(overrides['propulsion']))
  agentRegistry.register(new AvionicsAgent(overrides['avionics']))
  agentRegistry.register(new SimulationAgent(overrides['simulation']))
  agentRegistry.register(new DocumentationAgent(overrides['documentation']))
  agentRegistry.register(new RetrieverAgent(overrides['retriever']))

  // 注册无专门类的内置 agent（如 codereviewer，配置全在 DB seed，用 DynamicAgent 包装）
  registerBuiltinDynamicAgents()

  // 注册自定义 Agent
  try {
    registerCustomAgentsFromDB()
  } catch (err) {
    console.warn('[Agents] Failed to register custom agents:', err)
  }
}

export { reregisterBuiltinAgents } from './reregister'

export class AgentEngine {
  private orchestrator: OrchestratorAgent

  constructor() {
    registerAllAgents()
    this.orchestrator = agentRegistry.get('orchestrator') as OrchestratorAgent
  }

  async *handleUserMessage(
    conversationId: string,
    content: string,
    signal: AbortSignal,
    selectedAgent?: string,
    fileWorkspacePath?: string,
    dispatchMode?: 'single' | 'collaborative',
    forcedSkillIds?: string[]
  ): AsyncGenerator<StreamChunk> {
    // 从数据库加载对话历史，传递给 Agent 上下文
    const chatHistory: Array<{ role: string; content: string; agent_type?: string }> = []
    try {
      const messagesRepo = getMessagesRepo()
      const history = messagesRepo.listByConversation(conversationId)
      // 当前用户消息已在 chat.ipc.ts 中持久化，会出现在 history 末尾。
      // 它将作为 userMessage 单独传给 streamChat，这里必须剔除，否则 LLM 会看到
      // 两条相邻的 HumanMessage（一条来自历史，一条来自 userMessage），打乱注意力。
      const historyWithoutCurrent = history.slice(0, -1)
      // 加载最近 200 条消息（约 100 轮对话），覆盖绝大部分日常会话场景
      // 超长对话由 compressContext 自动摘要早期消息
      const recent = historyWithoutCurrent.slice(-200)

      for (const msg of recent) {
        chatHistory.push({ role: msg.role, content: msg.content, agent_type: msg.agent_type || undefined })
      }

      // 上下文压缩：超出阈值时自动摘要早期消息，保留最近 50 条完整
      // DeepSeek 上下文 1M，留 200K 给历史 + 摘要，剩余 800K 给系统提示/RAG/当前消息/响应/工具输出
      // 老配置可能存了 16000，用 Math.max 保证下限 200000
      const savedThreshold = getAppConfig().get('contextCompressionThreshold') || 0
      const threshold = Math.max(savedThreshold, 200000)
      // compressContext 在不超预算时会返回原数组引用，
      // 必须先 slice 一份副本再清空 chatHistory，否则 compressed 会被一起清空
      const compressed = await compressContext(chatHistory, threshold)
      const compressedCopy = compressed.slice()
      chatHistory.length = 0
      chatHistory.push(...compressedCopy)

      // 更新对话的 updated_at
      const convRepo = getConversationsRepo()
      convRepo.touch(conversationId)
    } catch (err) {
      // 历史加载/压缩失败不应静默——否则 agent 会拿到空历史且无任何线索
      console.warn('[AgentEngine] Failed to load/compress chat history:', err)
    }

    const context: AgentContext = { conversationId, signal, chatHistory, selectedAgent, fileWorkspacePath, dispatchMode, forcedSkillIds }

    for await (const chunk of this.orchestrator.run(content, context)) {
      if (signal.aborted) break
      yield chunk
    }
  }
}

export function initAgentEngine(): AgentEngine {
  agentEngine = new AgentEngine()
  return agentEngine
}

export function getAgentEngine(): AgentEngine | null {
  const config = getLLMConfig()

  // 闸门不再仅看 DeepSeek apiKey：
  // - 有 DeepSeek key → 总是可用（DeepSeek + 可能的 Pi/Ollama fallback）
  // - 无 DeepSeek key 但 Ollama 启用 → 可用（Pi 路径下 Ollama 作主模型，DeepSeek 路径作 fallback）
  // - 两者皆无 → 不可用
  // 注意：内置 general agent 在 DB seed 为 engine='pi'，其 runWithPi() 会在无 DeepSeek key 时
  // 抛 "DeepSeek API key not configured"——此时 Ollama fallback 接管（见 pi/agent-runner.ts）。
  // 故只要 Ollama 启用，即使无 DeepSeek key 也应放行，否则 Pi/Ollama-only 用户被锁死。
  if (!config.apiKey) {
    const ollama = getAppConfig().get('ollama')
    if (!ollama?.enabled) return null
  }

  if (!agentEngine) {
    agentEngine = new AgentEngine()
  }
  return agentEngine
}
