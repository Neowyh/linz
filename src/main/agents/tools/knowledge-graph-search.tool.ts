import { DynamicTool } from '@langchain/core/tools'
import { graphSearch, formatGraphSearchResult } from '../../graph/graph-rag'

// 知识图谱查询工具：通过实体关系图谱增强检索
// 与 knowledge_search（FTS 文本检索）互补，适用于探索实体间关系和概念关联
export function createKnowledgeGraphSearchTool(): DynamicTool {
  return new DynamicTool({
    name: 'query_knowledge_graph',
    description: `查询知识图谱，探索实体之间的关系和知识网络。

适用于：
- 理解实体间关系（如"翼型与升力的关系"）
- 探索概念关联和知识网络
- 查找特定实体的相关信息
- 理解技术架构和系统组成

不适用于：
- 普通文本搜索 → 用 knowledge_search
- 需要精确文档内容 → 用 knowledge_search

需要知识库已执行 AI 实体/关系增强抽取。`,
    func: async (input: string): Promise<string> => {
      try {
        const result = await graphSearch(input.trim())
        return formatGraphSearchResult(result)
      } catch (err: any) {
        return `知识图谱查询失败: ${err.message || String(err)}`
      }
    }
  })
}

export const knowledgeGraphSearchTool = createKnowledgeGraphSearchTool()
