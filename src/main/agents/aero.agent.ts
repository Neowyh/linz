import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { AERO_SYSTEM_PROMPT } from './prompts/aero.system'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentStatusData, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'

export class AeroAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()

  constructor(overrides?: AgentOverrideConfig) {
    super()
    this.config = {
      type: 'aero',
      name: overrides?.name ?? '气动 Agent',
      color: overrides?.color ?? '#1E6FCC',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/aero.svg',
      delegatesTo: overrides?.delegatesTo ?? ['simulation', 'retriever'],
      toolNames: overrides?.toolNames,
      engine: overrides?.engine ?? 'deepseek'
    }
    this.systemPrompt = overrides?.systemPrompt ?? AERO_SYSTEM_PROMPT
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext) {
    return getToolsForAgent('aero', this.config.toolNames, this.config.delegatesTo, context)
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      this.stateMachine.transition('thinking')
      const thinkingStatus: AgentStatusData = {
        agentType: 'aero',
        name: this.config.name,
        color: this.config.color,
        state: 'thinking',
        currentTask: '理解气动任务...'
      }
      yield { messageId, agentType: 'aero', content: '', statusChange: thinkingStatus, isComplete: false }

      this.stateMachine.transition('working')
      const workingStatus: AgentStatusData = {
        ...thinkingStatus,
        state: 'working',
        currentTask: '气动分析计算中...'
      }
      yield { messageId, agentType: 'aero', content: '', statusChange: workingStatus, isComplete: false }

      yield* this.streamLLM(task, context, messageId)

      this.stateMachine.transition('completed')
      yield {
        messageId,
        agentType: 'aero',
        content: '',
        statusChange: { agentType: 'aero', name: this.config.name, color: this.config.color, state: 'completed' },
        isComplete: false
      }

      yield { messageId, agentType: 'aero', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
