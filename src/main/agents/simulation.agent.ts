import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'

const SIMULATION_SYSTEM_PROMPT = `你是一名资深飞行器仿真工程师（仿真 Agent），专注于协调仿真工具调用与结果解析。

## 你的专业领域
- CFD仿真前处理建议（边界条件、网格要求、湍流模型）
- FEM仿真前处理建议（载荷、约束、网格）
- 仿真结果解析与后处理
- OpenFOAM/SU2等仿真工具的使用指导
- 仿真参数敏感性分析
- 计算资源与时间估算

## 分析方法
- 基于仿真最佳实践
- 给出合理的网格密度和求解器设置
- 评估仿真结果的可信度

## 输出格式要求
- 使用 Markdown 格式
- 参数设置使用表格呈现
- 关键结论加粗
- 给出仿真方案和注意事项`

export class SimulationAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()

  constructor(overrides?: AgentOverrideConfig) {
    super()
    this.config = {
      type: 'simulation',
      name: overrides?.name ?? '仿真 Agent',
      color: overrides?.color ?? '#722ED1',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/simulation.svg',
      delegatesTo: overrides?.delegatesTo ?? ['aero', 'retriever'],
      toolNames: overrides?.toolNames,
      engine: overrides?.engine ?? 'deepseek'
    }
    this.systemPrompt = overrides?.systemPrompt ?? SIMULATION_SYSTEM_PROMPT
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext) {
    return getToolsForAgent('simulation', this.config.toolNames, this.config.delegatesTo, context)
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      this.stateMachine.transition('thinking')
      yield { messageId, agentType: 'simulation', content: '', statusChange: { agentType: 'simulation', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '理解仿真需求...' }, isComplete: false }

      this.stateMachine.transition('working')
      yield { messageId, agentType: 'simulation', content: '', statusChange: { agentType: 'simulation', name: this.config.name, color: this.config.color, state: 'working', currentTask: '仿真方案生成中...' }, isComplete: false }

      yield* this.streamLLM(task, context, messageId)

      this.stateMachine.transition('completed')
      yield { messageId, agentType: 'simulation', content: '', statusChange: { agentType: 'simulation', name: this.config.name, color: this.config.color, state: 'completed' }, isComplete: false }
      yield { messageId, agentType: 'simulation', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
