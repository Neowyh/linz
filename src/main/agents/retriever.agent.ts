import { v4 as uuidv4 } from 'uuid'
import { AgentStateMachine } from './agent-state-machine'
import { searchKnowledgeBase, formatRagContext, hybridSearch } from '../ipc/knowledge.ipc'
import { BaseAgent } from './base.agent'
import type { AgentConfig, StreamChunk, AgentContext, AgentOverrideConfig } from './base.agent'
import { getToolsForAgent } from './tools'

const RETRIEVER_SYSTEM_PROMPT = `你是一名飞行器设计领域的文献检索与知识整合专家（检索 Agent），专注于知识检索和文献调研。

## 你的专业领域
- 飞行器设计文献检索与综述
- 技术标准与规范查询
- 相关案例与参考方案整理
- 学术论文要点提取
- 技术参数数据查证
- 跨专业知识整合

## 分析方法
- 基于公开文献和标准规范
- 标注信息来源和可靠性
- 区分已验证数据和估算数据
- 提供多个参考来源交叉验证

## 输出格式要求
- 使用 Markdown 格式
- 参考文献列表格式规范
- 关键发现加粗
- 来源标注清晰

## 注意事项
- 明确标注信息的来源和时效性
- 对无法验证的信息标注"待查证"
- 区分"行业通用做法"和"特定案例数据"
- 提供进一步查询的建议方向`

export class RetrieverAgent extends BaseAgent {
  readonly config: AgentConfig
  protected stateMachine = new AgentStateMachine()

  constructor(overrides?: AgentOverrideConfig) {
    super()
    this.config = {
      type: 'retriever',
      name: overrides?.name ?? '检索 Agent',
      color: overrides?.color ?? '#1890FF',
      modelName: overrides?.modelName ?? 'deepseek-chat',
      icon: overrides?.icon ?? 'assets/icons/retriever.svg',
      delegatesTo: overrides?.delegatesTo ?? [],
      toolNames: overrides?.toolNames,
      engine: overrides?.engine ?? 'deepseek'
    }
    this.systemPrompt = overrides?.systemPrompt ?? RETRIEVER_SYSTEM_PROMPT
    this.setStateMachine(this.stateMachine)
  }

  getAvailableTools(context?: AgentContext) {
    return getToolsForAgent('retriever', this.config.toolNames, this.config.delegatesTo, context)
  }

  async *run(task: string, context: AgentContext): AsyncGenerator<StreamChunk> {
    const messageId = uuidv4()

    try {
      this.stateMachine.transition('thinking')
      yield { messageId, agentType: 'retriever', content: '', statusChange: { agentType: 'retriever', name: this.config.name, color: this.config.color, state: 'thinking', currentTask: '理解检索需求...' }, isComplete: false }

      this.stateMachine.transition('working')
      yield { messageId, agentType: 'retriever', content: '', statusChange: { agentType: 'retriever', name: this.config.name, color: this.config.color, state: 'working', currentTask: '知识检索与整合中...' }, isComplete: false }

      // 先搜索知识库获取相关片段（优先混合检索）
      let ragContext = context.ragContext
      try {
        const searchResults = await hybridSearch(task, { limit: 5 }).catch(() => searchKnowledgeBase(task, { limit: 5 }))
        if (searchResults.length > 0) {
          const newContext = formatRagContext(searchResults)
          ragContext = ragContext ? `${ragContext}\n\n---\n\n[检索 Agent 补充检索]\n${newContext}` : newContext

          const sourceInfo = searchResults.map((r, i) => `${i + 1}. ${r.file_name}`).join('\n')
          yield {
            messageId, agentType: 'retriever',
            content: `\n**检索到 ${searchResults.length} 条相关知识库内容：**\n${sourceInfo}\n\n`,
            isComplete: false
          }
        } else {
          yield {
            messageId, agentType: 'retriever',
            content: '\n*未在知识库中找到直接匹配的内容，将基于通用知识回答。*\n\n',
            isComplete: false
          }
        }
      } catch (err) {
        console.warn('[RetrieverAgent] Knowledge base search failed:', err)
      }

      yield* this.streamLLM(task, context, messageId, ragContext)

      this.stateMachine.transition('completed')
      yield { messageId, agentType: 'retriever', content: '', statusChange: { agentType: 'retriever', name: this.config.name, color: this.config.color, state: 'completed' }, isComplete: false }
      yield { messageId, agentType: 'retriever', content: '', isComplete: true }
    } finally {
      this.stateMachine.reset()
    }
  }
}
