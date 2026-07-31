import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { GENERAL_SYSTEM_PROMPT } from './prompts/general.system'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentStatusData, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'
import { ensurePi } from '../pi'
import { runWithPi } from '../pi/agent-runner'

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

      // 按 engine 分流：先尝试加载 Pi SDK，加载失败才回退 DeepSeek
      let usePi = false
      if (this.config.engine === 'pi') {
        try {
          await ensurePi()
          usePi = true
        } catch (err: any) {
          console.warn('[GeneralAgent] Pi SDK load failed, falling back to DeepSeek:', err?.message || err)
        }
      }
      if (usePi) {
        yield* runWithPi(context, {
          agentType: 'general',
          agentName: this.config.name,
          agentColor: this.config.color,
          systemPrompt: this.getEffectiveSystemPrompt(task, context),
          task: this.prepareTaskWithContext(task),
          ragContext: context.ragContext,
          customTools: this.getAvailableTools(context)
        })
      } else {
        yield* this.streamLLM(task, context, messageId)
      }

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
