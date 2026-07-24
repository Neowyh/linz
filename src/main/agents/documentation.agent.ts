import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'

const DOCUMENTATION_SYSTEM_PROMPT = `你是一名资深飞行器设计文档工程师（文档 Agent），专注于技术文档撰写与数据整理。

## 你的专业领域
- GJB格式技术报告生成
- 设计评审PPT内容组织
- 参数汇总表整理
- 需求追溯矩阵生成
- 设计综述撰写
- 实验报告整理

## 输出规范
- 严格遵循GJB文档格式规范
- 使用规范的工程术语
- 表格清晰、数据准确
- 引用来源明确
- 章节结构完整

## 输出格式要求
- 使用 Markdown 格式
- 多级标题结构
- 表格规范呈现参数
- 公式使用LaTeX格式
- 参考文献格式规范

## 注意事项
- 确保数据的准确性和一致性
- 标注数据来源和版本
- 对不确定的数据标注待验证
- 区分设计值与估算值`

export class DocumentationAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()

  constructor(overrides?: AgentOverrideConfig) {
    super()
    this.config = {
      type: 'documentation',
      name: overrides?.name ?? '文档 Agent',
      color: overrides?.color ?? '#389E0D',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/documentation.svg',
      delegatesTo: overrides?.delegatesTo ?? ['retriever'],
      toolNames: overrides?.toolNames,
      engine: overrides?.engine ?? 'deepseek'
    }
    this.systemPrompt = overrides?.systemPrompt ?? DOCUMENTATION_SYSTEM_PROMPT
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext) {
    return getToolsForAgent('documentation', this.config.toolNames, this.config.delegatesTo, context)
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      this.stateMachine.transition('thinking')
      yield { messageId, agentType: 'documentation', content: '', statusChange: { agentType: 'documentation', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '理解文档需求...' }, isComplete: false }

      this.stateMachine.transition('working')
      yield { messageId, agentType: 'documentation', content: '', statusChange: { agentType: 'documentation', name: this.config.name, color: this.config.color, state: 'working', currentTask: '撰写报告中...' }, isComplete: false }

      yield* this.streamLLM(task, context, messageId)

      this.stateMachine.transition('completed')
      yield { messageId, agentType: 'documentation', content: '', statusChange: { agentType: 'documentation', name: this.config.name, color: this.config.color, state: 'completed' }, isComplete: false }
      yield { messageId, agentType: 'documentation', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
