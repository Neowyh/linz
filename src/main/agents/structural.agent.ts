import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'

const STRUCTURAL_SYSTEM_PROMPT = `你是一名资深飞行器结构设计工程师（结构 Agent），专注于飞行器结构分析与设计。

## 你的专业领域
- 结构方案设计与选型
- 强度与刚度估算
- 材料选型与对比（铝合金、复合材料、钛合金等）
- 疲劳寿命初步评估
- 连接件载荷分配分析
- 结构拓扑优化方案建议

## 分析方法
- 优先使用工程估算方法（如Raymer、Niu手册方法）
- 对估算精度诚实标注
- 给出合理的假设条件和安全系数
- 使用标准结构参数和术语

## 输出格式要求
- 使用 Markdown 格式，结构清晰
- 参数结果使用表格，包含符号、数值、单位
- 关键结论加粗
- 给出分析结论和设计建议

## 安全与规范
- 对超出工程合理范围的参数主动警示
- 标注分析结果的置信度（高/中/低）
- 强调结构安全裕度和验证需求
- 注明分析仅作为初步设计参考`

export class StructuralAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()

  constructor(overrides?: AgentOverrideConfig) {
    super()
    this.config = {
      type: 'structural',
      name: overrides?.name ?? '结构 Agent',
      color: overrides?.color ?? '#FA8C16',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/structural.svg',
      delegatesTo: overrides?.delegatesTo ?? ['simulation', 'retriever'],
      toolNames: overrides?.toolNames,
      engine: overrides?.engine ?? 'deepseek'
    }
    this.systemPrompt = overrides?.systemPrompt ?? STRUCTURAL_SYSTEM_PROMPT
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext) {
    const tools = getToolsForAgent('structural', this.config.toolNames, this.config.delegatesTo, context)
    return tools
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      this.stateMachine.transition('thinking')
      yield { messageId, agentType: 'structural', content: '', statusChange: { agentType: 'structural', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '理解结构任务...' }, isComplete: false }

      this.stateMachine.transition('working')
      yield { messageId, agentType: 'structural', content: '', statusChange: { agentType: 'structural', name: this.config.name, color: this.config.color, state: 'working', currentTask: '结构分析计算中...' }, isComplete: false }

      yield* this.streamLLM(task, context, messageId)

      this.stateMachine.transition('completed')
      yield { messageId, agentType: 'structural', content: '', statusChange: { agentType: 'structural', name: this.config.name, color: this.config.color, state: 'completed' }, isComplete: false }
      yield { messageId, agentType: 'structural', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
