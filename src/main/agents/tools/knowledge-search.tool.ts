import { DynamicTool } from '@langchain/core/tools'
import { searchKnowledgeBase } from '../../ipc/knowledge.ipc'

// 知识库检索工具工厂：fixedTags 非空时，检索范围限定为带这些标签的文档
// （如"安保问答agent"只检索"安保"标签文档，避免跨领域串扰）
export function createKnowledgeSearchTool(fixedTags?: string[]): DynamicTool {
  const tags = fixedTags && fixedTags.length > 0 ? fixedTags : undefined
  const tagNote = tags ? `检索范围已限定为标签【${tags.join('、')}】的文档。` : ''
  return new DynamicTool({
    name: 'knowledge_search',
    description: `搜索知识库获取相关技术文档和参考资料。输入搜索关键词或问题，返回相关的知识片段。用于获取标准规范、技术手册、设计案例等参考资料。${tagNote}`,
    func: async (input: string): Promise<string> => {
      try {
        const results = searchKnowledgeBase(input.trim(), { limit: 5, tags })
        if (results.length === 0) {
          return '未找到相关知识库内容。'
        }
        return results
          .map((r, i) => `[来源${i + 1}: ${r.file_name}]\n${r.content}`)
          .join('\n\n---\n\n')
      } catch (err: any) {
        return `知识库检索失败: ${err.message || String(err)}`
      }
    }
  })
}

export const knowledgeSearchTool = createKnowledgeSearchTool()
