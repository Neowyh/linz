import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { resolveToolsByNames, getToolsForAgent } from './tools'
import type { IAgent, AgentConfig, AgentState, StreamChunk, AgentContext, AgentStatusData, AgentMessage } from './base.agent'
import { BaseAgent } from './base.agent'
import type { Tool } from '@langchain/core/tools'

export interface CustomAgentRow {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  system_prompt: string
  tools: string          // JSON array string
  keywords: string       // JSON array string
  subtask_prefix: string | null
  delegates_to: string   // JSON array string
  model_name: string
  is_custom: number
  usage_count: number
  created_at: string
  updated_at: string
  engine: string         // 'deepseek' | 'pi'
}

export class DynamicAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()
  private toolNames: string[]

  constructor(row: CustomAgentRow) {
    super()
    this.config = {
      type: row.id,
      name: row.name,
      color: row.color,
      modelName: row.model_name || 'deepseek-chat',
      icon: row.icon || '🎯',
      delegatesTo: JSON.parse(row.delegates_to || '[]'),
      engine: (row.engine as 'deepseek' | 'pi') || 'deepseek'
    }
    this.systemPrompt = row.system_prompt
    this.toolNames = JSON.parse(row.tools || '[]')
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext): Tool[] {
    return getToolsForAgent(this.config.type, this.toolNames, this.config.delegatesTo, context)
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()
    try {
      this.stateMachine.transition('thinking')
      yield {
        messageId, agentType: this.config.type, content: '',
        statusChange: { agentType: this.config.type, name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '理解任务...' },
        isComplete: false
      }

      this.stateMachine.transition('working')
      yield {
        messageId, agentType: this.config.type, content: '',
        statusChange: { agentType: this.config.type, name: this.config.name, color: this.config.color, state: 'working', currentTask: '分析计算中...' },
        isComplete: false
      }

      yield* this.streamLLM(task, context, messageId)

      this.stateMachine.transition('completed')
      yield {
        messageId, agentType: this.config.type, content: '',
        statusChange: { agentType: this.config.type, name: this.config.name, color: this.config.color, state: 'completed' },
        isComplete: false
      }
      yield { messageId, agentType: this.config.type, content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
