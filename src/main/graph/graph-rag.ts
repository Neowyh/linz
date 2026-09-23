import * as kb from '../database/kb'
import { createChatModel } from '../llm'
import { streamChat } from '../llm/stream-handler'

// ============ 类型 ============
export interface GraphSearchEntity {
  entityId: string
  entityName: string
  entityType: string
  documentId: string
  fileName: string
}

export interface GraphSearchRelation {
  sourceName: string
  targetName: string
  label: string
}

export interface GraphSearchChunk {
  content: string
  document_id: string
  file_name: string
}

export interface GraphSearchResult {
  entities: GraphSearchEntity[]
  relations: GraphSearchRelation[]
  chunks: GraphSearchChunk[]
}

interface BaseSearchResult {
  content: string
  document_id: string
  file_name: string
  score: number
}

// ============ 查询时实体提取（对标 WeKnora PluginExtractEntity） ============

const QUERY_ENTITY_PROMPT = `从用户问题中提取关键实体名称，用于知识图谱检索。

要求：
- 提取问题中涉及的核心实体（技术、参数、部件、材料、标准、概念等）
- 实体名使用问题中出现的原始词汇，不要自己造词
- 最多提取 5 个实体
- 只输出 JSON 数组格式，不要输出任何解释或 markdown 围栏

输出格式：["实体1", "实体2", ...]

如果没有明确的实体，返回空数组 []。`

// 从用户查询中提取实体名称；图谱无实体或 LLM 失败时静默返回空数组
export async function extractQueryEntities(query: string): Promise<string[]> {
  if (kb.listGraphEntities().length === 0) return []
  if (!query.trim()) return []

  try {
    const llm = createChatModel({ timeout: 15000 })
    let output = ''
    for await (const chunk of streamChat(llm, {
      systemPrompt: QUERY_ENTITY_PROMPT,
      userMessage: query
    })) {
      if (typeof chunk === 'string') output += chunk
    }

    return parseEntityArray(output)
  } catch (err) {
    console.warn('[GraphRAG] extractQueryEntities failed:', err)
    return []
  }
}

function parseEntityArray(raw: string): string[] {
  const tryParse = (text: string): string[] | null => {
    try {
      const obj = JSON.parse(text)
      if (Array.isArray(obj)) {
        return obj.filter((s): s is string => typeof s === 'string' && s.trim().length > 0).map((s) => s.trim()).slice(0, 5)
      }
      return null
    } catch {
      return null
    }
  }

  const direct = tryParse(raw.trim())
  if (direct) return direct

  const match = raw.match(/\[[\s\S]*\]/)
  if (match) {
    const parsed = tryParse(match[0])
    if (parsed) return parsed
  }

  return []
}

// ============ GraphRAG 检索增强（对标 WeKnora PluginSearchEntity） ============

// 用图谱实体增强已有检索结果：提取查询实体 → 匹配图谱 → 获取关联文档块 → RRF 融合
// baseResults 由调用方通过 hybridSearch 获取，避免循环依赖
export async function enhanceSearchWithGraph(
  query: string,
  baseResults: BaseSearchResult[],
  limit: number
): Promise<BaseSearchResult[]> {
  // 1. 从查询中提取实体
  const entityNames = await extractQueryEntities(query)
  if (entityNames.length === 0) return baseResults

  // 2. 匹配图谱实体
  const entityMatches = kb.searchEntitiesByName(entityNames)
  if (entityMatches.length === 0) return baseResults

  // 3. 收集关联文档，做 FTS 检索补充
  const docIds = [...new Set(entityMatches.map((m) => m.documentId))]
  const graphChunks = kb.searchInDocs(query, docIds, limit * 2)

  if (graphChunks.length === 0) return baseResults

  // 4. 过滤已在 base 结果中的块（按 document_id + content 前缀去重）
  const seenKeys = new Set(baseResults.map((r) => `${r.document_id}:${r.content.substring(0, 50)}`))
  const newChunks = graphChunks.filter((c) => {
    const key = `${c.document_id}:${c.content.substring(0, 50)}`
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
    return true
  })

  if (newChunks.length === 0) return baseResults

  // 5. RRF 融合：base 结果权重高（rank 0 起），graph 补充结果从 base 末尾后开始
  // base rank 优先，graph 结果赋予较低 RRF 权重避免噪声稀释
  const RRF_K = 60
  const rrfScores = new Map<string, BaseSearchResult & { rrf: number }>()

  baseResults.forEach((r, idx) => {
    const key = `${r.document_id}:${r.content.substring(0, 50)}`
    const existing = rrfScores.get(key)
    const contribution = 1 / (RRF_K + idx + 1)
    if (existing) {
      existing.rrf += contribution
    } else {
      rrfScores.set(key, { ...r, rrf: contribution })
    }
  })

  // graph 结果从 base.length 排名开始（权重低于所有 base 结果）
  const graphStartRank = baseResults.length
  newChunks.forEach((c, idx) => {
    const key = `${c.document_id}:${c.content.substring(0, 50)}`
    const contribution = 1 / (RRF_K + graphStartRank + idx + 1)
    const existing = rrfScores.get(key)
    if (existing) {
      existing.rrf += contribution
    } else {
      rrfScores.set(key, {
        content: c.content,
        document_id: c.document_id,
        file_name: c.file_name,
        score: c.score,
        rrf: contribution
      })
    }
  })

  return Array.from(rrfScores.values())
    .sort((a, b) => b.rrf - a.rrf)
    .slice(0, limit)
    .map(({ rrf, ...rest }) => rest)
}

// ============ 完整图谱查询（供 Agent 工具使用） ============

// 返回匹配实体 + 关系 + 关联文档片段
export async function graphSearch(query: string): Promise<GraphSearchResult> {
  const result: GraphSearchResult = { entities: [], relations: [], chunks: [] }

  // 1. 提取查询实体
  const entityNames = await extractQueryEntities(query)
  if (entityNames.length === 0) return result

  // 2. 匹配图谱实体
  const entityMatches = kb.searchEntitiesByName(entityNames)
  if (entityMatches.length === 0) return result

  result.entities = entityMatches.map((m) => ({
    entityId: m.entityId,
    entityName: m.entityName,
    entityType: m.entityType || '概念',
    documentId: m.documentId,
    fileName: m.fileName
  }))

  // 3. 收集关系（去重）
  const seenRels = new Set<string>()
  for (const entity of entityMatches) {
    const rels = kb.getEntityRelations(entity.entityId)
    for (const rel of rels) {
      const key = `${rel.source_entity}|${rel.target_entity}|${rel.relation_label}`
      if (seenRels.has(key)) continue
      seenRels.add(key)
      result.relations.push({
        sourceName: rel.sourceName || entity.entityName,
        targetName: rel.targetName || '未知',
        label: rel.relation_label
      })
    }
  }

  // 4. 获取关联文档片段
  const docIds = [...new Set(entityMatches.map((m) => m.documentId))]
  const chunks = kb.searchInDocs(query, docIds, 5)
  result.chunks = chunks.map((c) => ({
    content: c.content,
    document_id: c.document_id,
    file_name: c.file_name
  }))

  return result
}

// ============ 格式化输出（供 Agent 工具直接返回） ============

export function formatGraphSearchResult(result: GraphSearchResult): string {
  if (result.entities.length === 0) {
    return '知识图谱中未找到与查询匹配的实体。请先对相关文档执行 AI 实体/关系增强抽取。'
  }

  let output = '=== 知识图谱查询结果 ===\n\n'

  output += '匹配实体：\n'
  result.entities.forEach((e, i) => {
    output += `${i + 1}. [${e.entityType}] ${e.entityName} (来源: ${e.fileName})\n`
  })
  output += '\n'

  if (result.relations.length > 0) {
    output += '实体关系：\n'
    result.relations.forEach((r) => {
      output += `- ${r.sourceName} → ${r.label} → ${r.targetName}\n`
    })
    output += '\n'
  }

  if (result.chunks.length > 0) {
    output += '相关文档片段：\n'
    result.chunks.forEach((c, i) => {
      output += `[来源${i + 1}: ${c.file_name}]\n${c.content}\n`
      if (i < result.chunks.length - 1) output += '\n---\n\n'
    })
  }

  return output
}
