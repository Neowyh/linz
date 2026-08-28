import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { GENERAL_SYSTEM_PROMPT } from './prompts/general.system'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentStatusData, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'

export class GeneralAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()

  constructor(overrides?: AgentOverrideConfig) {
    super()
    this.config = {
      type: 'general',
      name: overrides?.name ?? '普通对话',
      color: overrides?.color ?? '#1677FF',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/general.svg',
      delegatesTo: overrides?.delegatesTo ?? ['retriever'],
      toolNames: overrides?.toolNames,
      engine: overrides?.engine ?? 'pi'
    }
    this.systemPrompt = overrides?.systemPrompt ?? GENERAL_SYSTEM_PROMPT
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext) {
    return getToolsForAgent('general', this.config.toolNames, this.config.delegatesTo, context)
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      this.stateMachine.transition('thinking')
      const thinkingStatus: AgentStatusData = {
        agentType: 'general',
        name: this.config.name,
        color: this.config.color,
        state: 'thinking',
        currentTask: '理解问题...'
      }
      yield { messageId, agentType: 'general', content: '', statusChange: thinkingStatus, isComplete: false }

      this.stateMachine.transition('working')
      const workingStatus: AgentStatusData = {
        ...thinkingStatus,
        state: 'working',
        currentTask: '思考回答中...'
      }
      yield { messageId, agentType: 'general', content: '', statusChange: workingStatus, isComplete: false }

      // 统一走 BaseAgent.streamLLM：自动按 config.engine 分流 Pi/DeepSeek，
      // 且会预发 skillTriggers chunk（强制技能 + 关键词匹配）。
      // 与 aero/structural 等其他内置 agent 实现对齐。
      yield* this.streamLLM(task, context, messageId)

      this.stateMachine.transition('completed')
      yield {
        messageId,
        agentType: 'general',
        content: '',
        statusChange: { agentType: 'general', name: this.config.name, color: this.config.color, state: 'completed' },
        isComplete: false
      }

      yield { messageId, agentType: 'general', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
