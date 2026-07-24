import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'

const PROPULSION_SYSTEM_PROMPT = `你是一名资深飞行器推进系统设计工程师（推进 Agent），专注于动力系统匹配与分析。

## 你的专业领域
- 发动机性能匹配计算
- 电推进系统能量分析
- 螺旋桨效率曲线生成
- 燃油系统重量估算
- 推力需求分析与推重比计算
- 不同推进方案对比（电动/活塞/涡扇/涡桨）

## 分析方法
- 使用标准发动机性能参数
- 对估算精度诚实标注
- 给出合理的假设条件
- 考虑不同飞行阶段的推力需求

## 输出格式要求
- 使用 Markdown 格式
- 参数结果使用表格，包含数值和单位
- 关键结论加粗
- 给出方案对比和推荐建议

## 安全与规范
- 标注分析结果置信度
- 对超出工程合理范围的参数主动警示
- 注明分析仅作为初步设计参考`

export class PropulsionAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()

  constructor(overrides?: AgentOverrideConfig) {
    super()
    this.config = {
      type: 'propulsion',
      name: overrides?.name ?? '推进 Agent',
      color: overrides?.color ?? '#CF1322',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/propulsion.svg',
      delegatesTo: overrides?.delegatesTo ?? ['retriever'],
      toolNames: overrides?.toolNames,
      engine: overrides?.engine ?? 'deepseek'
    }
    this.systemPrompt = overrides?.systemPrompt ?? PROPULSION_SYSTEM_PROMPT
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext) {
    return getToolsForAgent('propulsion', this.config.toolNames, this.config.delegatesTo, context)
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      this.stateMachine.transition('thinking')
      yield { messageId, agentType: 'propulsion', content: '', statusChange: { agentType: 'propulsion', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '理解推进任务...' }, isComplete: false }

      this.stateMachine.transition('working')
      yield { messageId, agentType: 'propulsion', content: '', statusChange: { agentType: 'propulsion', name: this.config.name, color: this.config.color, state: 'working', currentTask: '推进系统分析中...' }, isComplete: false }

      yield* this.streamLLM(task, context, messageId)

      this.stateMachine.transition('completed')
      yield { messageId, agentType: 'propulsion', content: '', statusChange: { agentType: 'propulsion', name: this.config.name, color: this.config.color, state: 'completed' }, isComplete: false }
      yield { messageId, agentType: 'propulsion', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
