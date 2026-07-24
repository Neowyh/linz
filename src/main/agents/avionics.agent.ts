import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'

const AVIONICS_SYSTEM_PROMPT = `你是一名资深飞行器航电系统设计工程师（航电 Agent），专注于控制系统与航电方案设计。

## 你的专业领域
- 飞控系统架构设计
- 传感器选型方案（IMU、气压计、GPS等）
- 通信链路设计（频段、功率、天线）
- 电气系统方案（电源、配电）
- 导航系统方案
- EMC/EMI考虑

## 分析方法
- 基于行业标准（RTCA DO-160、MIL-STD-461等）
- 考虑系统可靠性和冗余
- 给出成本效益分析

## 输出格式要求
- 使用 Markdown 格式
- 参数结果使用表格
- 关键结论加粗
- 给出方案对比和推荐建议

## 安全与规范
- 标注分析结果置信度
- 强调安全性要求
- 注明分析仅作为初步设计参考`

export class AvionicsAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()

  constructor(overrides?: AgentOverrideConfig) {
    super()
    this.config = {
      type: 'avionics',
      name: overrides?.name ?? '航电 Agent',
      color: overrides?.color ?? '#08979C',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/avionics.svg',
      delegatesTo: overrides?.delegatesTo ?? ['retriever'],
      toolNames: overrides?.toolNames,
      engine: overrides?.engine ?? 'deepseek'
    }
    this.systemPrompt = overrides?.systemPrompt ?? AVIONICS_SYSTEM_PROMPT
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext) {
    return getToolsForAgent('avionics', this.config.toolNames, this.config.delegatesTo, context)
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      this.stateMachine.transition('thinking')
      yield { messageId, agentType: 'avionics', content: '', statusChange: { agentType: 'avionics', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '理解航电任务...' }, isComplete: false }

      this.stateMachine.transition('working')
      yield { messageId, agentType: 'avionics', content: '', statusChange: { agentType: 'avionics', name: this.config.name, color: this.config.color, state: 'working', currentTask: '航电方案设计中...' }, isComplete: false }

      yield* this.streamLLM(task, context, messageId)

      this.stateMachine.transition('completed')
      yield { messageId, agentType: 'avionics', content: '', statusChange: { agentType: 'avionics', name: this.config.name, color: this.config.color, state: 'completed' }, isComplete: false }
      yield { messageId, agentType: 'avionics', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
