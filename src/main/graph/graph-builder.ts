import crypto from 'crypto'
import * as kb from '../database/kb'
import { createChatModel } from '../llm'
import { streamChat } from '../llm/stream-handler'

// ============ 类型（与 preload/index.d.ts 中的 GraphPayload 保持一致） ============
export interface GraphNode {
  id: string
  kind: 'document' | 'entity'
  label: string
  category?: string
  tags?: string[]
  chunkCount?: number
  entityType?: string
  docIds?: string[]        // entity 节点：来源文档 id 列表（跨文档合流）
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'similar' | 'relation' | 'mentions'
  weight?: number
  label?: string
}

export interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
  entityCount: number
}

// ============ 相似度评分权重（可调） ============
const W_TAG = 0.45
const W_CATEGORY = 0.10
const W_TFIDF = 0.45
// 候选边入库的最低分（低于此直接丢弃，减少内存）；前端阈值在此基础上再过滤
const BASE_THRESHOLD = 0.05
// 每节点最多保留的相似边数，防 hub 节点拖垮布局
const MAX_EDGES_PER_NODE = 8
// 文档数超过此值时降低采样量保性能
const LARGE_LIB_DOC_COUNT = 400

interface DocMeta {
  id: string
  fileName: string
  category: string
  tags: string[]
  chunkCount: number
}

// ============ 相似度图缓存（纯派生数据，随 kb 变更失效） ============
interface SimilarityCache {
  docs: DocMeta[]
  // 所有得分 >= BASE_THRESHOLD 的候选边（未做 topN 截断，截断随阈值过滤时进行）
  scoredEdges: Array<{ source: string; target: string; score: number }>
  truncated: boolean
}

let similarityCache: SimilarityCache | null = null

export function invalidateGraphCache(): void {
  similarityCache = null
}

// 注册到 kb 变更监听：导入/删除/改标签/改分类/切库都会触发（见 kb.ts invalidateTagsCache）
kb.onKbChange(() => {
  invalidateGraphCache()
})

// 解析 tags JSON 列为 string[]。历史/导入数据里个别 tag 可能存成了对象
// （如 { name: "气动" }），若原样透传到图节点，前端 .map 渲染会触发
// React "Objects are not valid as a React child" 致命错误并白屏。
// 这里强制把每个元素规整为字符串，对象取 name/id/label/value。
function parseTags(tagsJson: string): string[] {
  let arr: unknown
  try {
    arr = JSON.parse(tagsJson || '[]')
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const out: string[] = []
  for (const v of arr) {
    let s: string
    if (typeof v === 'string') s = v
    else if (typeof v === 'number' || typeof v === 'boolean') s = String(v)
    else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      s = typeof o.name === 'string' ? o.name
        : typeof o.id === 'string' ? o.id
        : typeof o.label === 'string' ? o.label
        : typeof o.value === 'string' ? o.value
        : safeStringify(o)
    } else {
      s = v == null ? '' : String(v)
    }
    s = s.trim()
    if (s.length > 0) out.push(s)
  }
  return out
}

function safeStringify(o: Record<string, unknown>): string {
  try { return JSON.stringify(o) } catch { return '[object]' }
}

function tagJaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let inter = 0
  for (const t of setA) if (setB.has(t)) inter++
  return inter / (setA.size + setB.size - inter)
}

// 构建相似度候选边：TF-IDF 余弦（主） + 标签 Jaccard + 同分类（辅）
// 稀疏化：倒排索引只让共享 >=1 有效词的文档对进入候选，避免 O(N²) 全比较
function buildSimilarityCache(): SimilarityCache {
  const rows = kb.listGraphDocuments()
  const docCount = rows.length
  const truncated = docCount > LARGE_LIB_DOC_COUNT
  // 大库降级：减少采样 chunk 数与每文档词数
  const vecs = kb.getDocumentTermVectors(
    truncated ? 15 : 30,
    20000,
    truncated ? 25 : 40
  )

  const docs: DocMeta[] = rows.map((r) => ({
    id: r.id,
    fileName: r.file_name,
    category: r.domain_category,
    tags: parseTags(r.tags),
    chunkCount: r.chunk_count
  }))

  if (docCount === 0) {
    return { docs, scoredEdges: [], truncated }
  }

  // df 统计 + idf；丢弃 df > 0.8N 的泛词（"设计""报告"之类）
  const df = new Map<string, number>()
  const vecMap = new Map<string, Map<string, number>>()
  for (const v of vecs) {
    vecMap.set(v.docId, v.terms)
    for (const term of v.terms.keys()) {
      df.set(term, (df.get(term) || 0) + 1)
    }
  }
  const idf = new Map<string, number>()
  for (const [term, freq] of df) {
    if (freq > 0.8 * docCount) continue
    idf.set(term, Math.log(docCount / (1 + freq)))
  }

  // 每文档 tf-idf 加权向量 + 模长；倒排索引 term -> docIds
  const norms = new Map<string, number>()
  const inverted = new Map<string, string[]>()
  for (const [docId, terms] of vecMap) {
    let norm = 0
    for (const [term, tf] of terms) {
      const w = idf.get(term)
      if (w === undefined) continue
      norm += (tf * w) * (tf * w)
      const list = inverted.get(term)
      if (list) list.push(docId)
      else inverted.set(term, [docId])
    }
    norms.set(docId, Math.sqrt(norm))
  }

  // 候选对余弦累积：只遍历共享词
  const pairDot = new Map<string, number>() // "docA|docB" (docA < docB) -> dot
  for (const [term, docIds] of inverted) {
    const w = idf.get(term)!
    for (let i = 0; i < docIds.length; i++) {
      const tfA = vecMap.get(docIds[i])!.get(term)!
      for (let j = i + 1; j < docIds.length; j++) {
        const a = docIds[i] < docIds[j] ? docIds[i] : docIds[j]
        const b = docIds[i] < docIds[j] ? docIds[j] : docIds[i]
        const key = `${a}|${b}`
        const tfB = vecMap.get(docIds[j])!.get(term)!
        pairDot.set(key, (pairDot.get(key) || 0) + tfA * w * (tfB * w))
      }
    }
  }

  const docMetaMap = new Map(docs.map((d) => [d.id, d]))
  const scoredEdges: SimilarityCache['scoredEdges'] = []

  // 文本候选边：余弦 + 结构化先验
  for (const [key, dot] of pairDot) {
    const [a, b] = key.split('|')
    const normA = norms.get(a) || 0
    const normB = norms.get(b) || 0
    const cosine = normA > 0 && normB > 0 ? dot / (normA * normB) : 0
    const metaA = docMetaMap.get(a)!
    const metaB = docMetaMap.get(b)!
    const score =
      W_TAG * tagJaccard(metaA.tags, metaB.tags) +
      W_CATEGORY * (metaA.category === metaB.category && metaA.category !== '未分类' ? 1 : 0) +
      W_TFIDF * cosine
    if (score >= BASE_THRESHOLD) scoredEdges.push({ source: a, target: b, score })
  }

  // 纯结构化候选边：无共享词但共享标签/同分类（短文本余弦可能为 0）
  for (let i = 0; i < docs.length; i++) {
    for (let j = i + 1; j < docs.length; j++) {
      const a = docs[i]
      const b = docs[j]
      const key = `${a.id}|${b.id}`
      if (pairDot.has(key)) continue
      const score =
        W_TAG * tagJaccard(a.tags, b.tags) +
        W_CATEGORY * (a.category === b.category && a.category !== '未分类' ? 1 : 0)
      if (score >= BASE_THRESHOLD) scoredEdges.push({ source: a.id, target: b.id, score })
    }
  }

  return { docs, scoredEdges, truncated }
}

function getSimilarityCache(): SimilarityCache {
  if (!similarityCache) {
    similarityCache = buildSimilarityCache()
  }
  return similarityCache
}

// 按阈值过滤 + 每节点 topN 截断
function filterEdges(
  scoredEdges: SimilarityCache['scoredEdges'],
  threshold: number
): Array<{ source: string; target: string; score: number }> {
  const passed = scoredEdges.filter((e) => e.score >= threshold)
  // 每节点按分数保留 topN
  const perNode = new Map<string, Array<{ other: string; score: number; edge: (typeof passed)[number] }>>()
  for (const e of passed) {
    for (const [self, other] of [[e.source, e.target], [e.target, e.source]] as Array<[string, string]>) {
      let list = perNode.get(self)
      if (!list) {
        list = []
        perNode.set(self, list)
      }
      list.push({ other, score: e.score, edge: e })
    }
  }
  const kept = new Set<(typeof passed)[number]>()
  for (const list of perNode.values()) {
    list.sort((a, b) => b.score - a.score)
    for (let i = 0; i < Math.min(MAX_EDGES_PER_NODE, list.length); i++) {
      kept.add(list[i].edge)
    }
  }
  return passed.filter((e) => kept.has(e))
}

// ============ 图谱构建（相似度层 + 可选叠加已持久化的 LLM 实体层） ============
// 注意：不按阈值过滤。固定返回 BASE_THRESHOLD 以上、经 topN 截断的全部候选边（带 weight），
// 阈值过滤由前端做显隐切换——这样拖动阈值滑块时无需重新请求/重排布局，保证丝滑。
export function buildGraph(options?: { includeEntities?: boolean }): GraphPayload {
  const cache = getSimilarityCache()

  const nodes: GraphNode[] = cache.docs.map((d) => ({
    id: `doc:${d.id}`,
    kind: 'document',
    label: d.fileName,
    category: d.category,
    tags: d.tags,
    chunkCount: d.chunkCount,
    docIds: [d.id]
  }))

  const edges: GraphEdge[] = filterEdges(cache.scoredEdges, BASE_THRESHOLD).map((e) => ({
    id: `sim:${e.source}:${e.target}`,
    source: `doc:${e.source}`,
    target: `doc:${e.target}`,
    kind: 'similar',
    weight: Math.round(e.score * 1000) / 1000
  }))

  let entityCount = 0
  if (options?.includeEntities) {
    entityCount = appendEntityLayer(nodes, edges)
  }

  return { nodes, edges, truncated: cache.truncated, entityCount }
}

// 把持久化的实体/关系叠加到图上；实体跨文档合流为单节点，mentions 边连到来源文档
function appendEntityLayer(nodes: GraphNode[], edges: GraphEdge[]): number {
  const entityRows = kb.listGraphEntities()
  if (entityRows.length === 0) return 0

  const entityMap = new Map<string, GraphNode & { docIdSet: Set<string> }>()
  for (const row of entityRows) {
    let node = entityMap.get(row.id)
    if (!node) {
      node = {
        id: row.id,
        kind: 'entity',
        label: row.name,
        entityType: row.entity_type || undefined,
        docIds: [],
        docIdSet: new Set<string>()
      }
      entityMap.set(row.id, node)
    }
    if (!node.docIdSet.has(row.document_id)) {
      node.docIdSet.add(row.document_id)
      node.docIds!.push(row.document_id)
    }
  }

  for (const node of entityMap.values()) {
    const { docIdSet, ...graphNode } = node
    nodes.push(graphNode)
    for (const docId of docIdSet) {
      edges.push({
        id: `men:${node.id}:${docId}`,
        source: node.id,
        target: `doc:${docId}`,
        kind: 'mentions'
      })
    }
  }

  const validEntityIds = new Set(entityMap.keys())
  const seenRel = new Set<string>()
  for (const rel of kb.listGraphRelations()) {
    if (!validEntityIds.has(rel.source_entity) || !validEntityIds.has(rel.target_entity)) continue
    const relKey = `${rel.source_entity}|${rel.target_entity}|${rel.relation_label}`
    if (seenRel.has(relKey)) continue
    seenRel.add(relKey)
    edges.push({
      id: rel.id,
      source: rel.source_entity,
      target: rel.target_entity,
      kind: 'relation',
      label: rel.relation_label
    })
  }

  return entityMap.size
}

// ============ LLM 实体/关系抽取 ============

const ENTITY_TYPES = ['技术', '参数', '部件', '材料', '标准', '概念']
const ENRICH_INPUT_MAX_CHARS = 2500
const MAX_ENTITIES_PER_DOC = 12
const MAX_RELATIONS_PER_DOC = 15

export interface EnrichProgress {
  total: number
  done: number
  fileName: string
  status: 'extracting' | 'done' | 'skipped' | 'error'
  error?: string
}

export interface EnrichSummary {
  done: number
  skipped: number
  failed: number
  entityCount: number
}

function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex')
}

function normalizeEntityName(name: string): string {
  return name.trim().replace(/\s+/g, '')
}

function entityId(name: string): string {
  return `ent:${sha1(normalizeEntityName(name).toLowerCase()).slice(0, 16)}`
}

function relationId(sourceName: string, targetName: string, label: string): string {
  const key = `${normalizeEntityName(sourceName)}|${normalizeEntityName(targetName)}|${label.trim()}`.toLowerCase()
  return `rel:${sha1(key).slice(0, 16)}`
}

// 内容指纹：标签+分类+块数+首尾块节选。变了才重抽，没变跳过
function buildContentFingerprint(doc: kb.KbDocumentRow, chunkContents: string[]): string {
  const first = chunkContents[0]?.slice(0, 200) || ''
  const last = chunkContents.length > 1 ? chunkContents[chunkContents.length - 1].slice(0, 200) : ''
  return sha1(`${doc.tags}|${doc.domain_category}|${doc.chunk_count}|${first}|${last}`)
}

// 采样：前 3 块 + 中 1 块 + 末 1 块，总字符硬上限 ENRICH_INPUT_MAX_CHARS
function sampleChunksForEnrichment(chunkContents: string[]): string {
  if (chunkContents.length === 0) return ''
  const picked: string[] = []
  const idx = new Set<number>()
  const add = (i: number): void => {
    if (i >= 0 && i < chunkContents.length && !idx.has(i)) {
      idx.add(i)
      picked.push(chunkContents[i])
    }
  }
  for (let i = 0; i < Math.min(3, chunkContents.length); i++) add(i)
  add(Math.floor(chunkContents.length / 2))
  add(chunkContents.length - 1)

  let text = picked.join('\n\n')
  if (text.length > ENRICH_INPUT_MAX_CHARS) {
    text = text.slice(0, ENRICH_INPUT_MAX_CHARS) + '\n...(已截断)'
  }
  return text
}

const EXTRACT_SYSTEM_PROMPT = `你是飞行器设计领域的知识工程师。从给定文档片段中抽取关键实体和实体间的关系，用于构建知识图谱。

要求：
- 实体：文档中出现的领域重要概念，如技术、参数、部件、材料、标准、概念。最多 ${MAX_ENTITIES_PER_DOC} 个。
- 关系：实体间的语义关系，如"决定""影响""是...的子系统""优化""遵循"。最多 ${MAX_RELATIONS_PER_DOC} 条。
- 实体名必须使用文档原文术语，不要自己造词。
- 关系的 source 和 target 必须是你抽取的实体名。
- 只输出 JSON，不要输出 markdown 代码围栏，不要任何解释。

输出格式（严格遵守）：
{"entities":[{"name":"实体名","type":"类型"}],"relations":[{"source":"实体A","target":"实体B","label":"关系"}]}

type 只能是以下之一：${ENTITY_TYPES.join('、')}。`

interface ExtractedEntity { name: string; type?: string }
interface ExtractedRelation { source: string; target: string; label?: string }
interface ExtractedGraph { entities: ExtractedEntity[]; relations: ExtractedRelation[] }

// 容错解析：直接 JSON.parse → 失败则提取首个 {...} 块重试 → 再失败返回 null
function parseExtractedJson(raw: string): ExtractedGraph | null {
  const tryParse = (text: string): ExtractedGraph | null => {
    try {
      const obj = JSON.parse(text)
      if (obj && Array.isArray(obj.entities)) {
        return {
          entities: obj.entities.filter((e: unknown) => e && typeof (e as ExtractedEntity).name === 'string'),
          relations: Array.isArray(obj.relations)
            ? obj.relations.filter((r: unknown) => r && typeof (r as ExtractedRelation).source === 'string' && typeof (r as ExtractedRelation).target === 'string')
            : []
        }
      }
      return null
    } catch {
      return null
    }
  }

  const direct = tryParse(raw.trim())
  if (direct) return direct

  const match = raw.match(/\{[\s\S]*\}/)
  if (match) return tryParse(match[0])
  return null
}

async function extractFromDocument(
  doc: kb.KbDocumentRow,
  chunkContents: string[]
): Promise<{ entities: Array<{ id: string; name: string; entityType: string }>; relations: Array<{ id: string; sourceEntity: string; targetEntity: string; label: string }> }> {
  const sample = sampleChunksForEnrichment(chunkContents)
  if (!sample) return { entities: [], relations: [] }

  const tags = parseTags(doc.tags)
  const userMessage = `文档：${doc.file_name}\n分类：${doc.domain_category}\n标签：${tags.join('、') || '无'}\n\n内容片段：\n${sample}`

  const llm = createChatModel({ timeout: 90000 })
  let output = ''
  for await (const chunk of streamChat(llm, { systemPrompt: EXTRACT_SYSTEM_PROMPT, userMessage })) {
    if (typeof chunk === 'string') output += chunk
  }

  const parsed = parseExtractedJson(output)
  if (!parsed) throw new Error('LLM 输出无法解析为 JSON')

  const entities = parsed.entities.slice(0, MAX_ENTITIES_PER_DOC).map((e) => ({
    id: entityId(e.name),
    name: normalizeEntityName(e.name),
    entityType: ENTITY_TYPES.includes(e.type || '') ? e.type! : '概念'
  }))
  const entityIds = new Set(entities.map((e) => e.id))
  const relations = parsed.relations
    .slice(0, MAX_RELATIONS_PER_DOC)
    .map((r) => ({
      id: relationId(r.source, r.target, r.label || '相关'),
      sourceEntity: entityId(r.source),
      targetEntity: entityId(r.target),
      label: (r.label || '相关').trim().slice(0, 20)
    }))
    .filter((r) => entityIds.has(r.sourceEntity) && entityIds.has(r.targetEntity) && r.sourceEntity !== r.targetEntity)

  return { entities, relations }
}

// 逐文档抽取：content_hash 去重跳过，单文档失败不阻塞整批，进度经回调推送
export async function enrichDocuments(
  docIds: string[],
  onProgress?: (p: EnrichProgress) => void
): Promise<EnrichSummary> {
  const allDocs = kb.listGraphDocuments()
  const docMap = new Map(allDocs.map((d) => [d.id, d]))
  const targets = docIds.map((id) => docMap.get(id)).filter((d): d is kb.KbDocumentRow => !!d)

  let done = 0
  let skipped = 0
  let failed = 0

  for (let i = 0; i < targets.length; i++) {
    const doc = targets[i]
    const base = { total: targets.length, done: i, fileName: doc.file_name }

    const chunkContents = kb.getAllChunkContents(doc.id)
    const fingerprint = buildContentFingerprint(doc, chunkContents)
    if (kb.getEnrichmentHash(doc.id) === fingerprint) {
      skipped++
      onProgress?.({ ...base, status: 'skipped' })
      continue
    }

    onProgress?.({ ...base, status: 'extracting' })
    try {
      const { entities, relations } = await extractFromDocument(doc, chunkContents)
      kb.replaceGraphDataForDoc(doc.id, entities, relations, fingerprint)
      done++
      onProgress?.({ ...base, done: i + 1, status: 'done' })
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[Graph] Enrich failed for ${doc.file_name}:`, message)
      onProgress?.({ ...base, done: i + 1, status: 'error', error: message })
    }
  }

  return { done, skipped, failed, entityCount: kb.listGraphEntities().length }
}
