import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import { getEmbedding, isEmbeddingReady } from '../embedding'
import { createChatModel } from '../llm'
import { streamChat } from '../llm/stream-handler'
import * as kb from '../database/kb'
import { buildGraph, enrichDocuments } from '../graph/graph-builder'
import { enhanceSearchWithGraph, graphSearch } from '../graph/graph-rag'
import { generateWiki } from '../wiki/wiki-generator'
import { getWikiGraph } from '../wiki/wiki-graph'
import { startImport, isImportRunning, type ImportSummary } from '../kb/import-manager'

export type SearchResult = kb.KbSearchResult

// BM25（FTS5 trigram→bigram 分词）关键词搜索，支持标签过滤
export function searchChunks(query: string, limit = 10, tags?: string[]): Array<SearchResult> {
  return kb.searchFts(query, limit, { tags })
}

// 高级知识库检索函数，供 Agent 直接调用（无需 IPC）
export function searchKnowledgeBase(
  query: string,
  options?: { domain?: string; limit?: number; tags?: string[] }
): Array<SearchResult> {
  return kb.searchFts(query, options?.limit || 5, { domain: options?.domain, tags: options?.tags })
}

// 混合检索：BM25 + 向量语义 → RRF 融合重排
// （当前 embedding 模型不可用，isEmbeddingReady() 恒 false，实际等价于纯 BM25）
export async function hybridSearch(
  query: string,
  options?: { domain?: string; limit?: number; tags?: string[] }
): Promise<Array<SearchResult>> {
  const limit = options?.limit || 5
  const filters = { domain: options?.domain, tags: options?.tags }
  const bm25Results = kb.searchFts(query, limit * 2, filters)
  let vectorResults: Array<{ chunkId: string; documentId: string; content: string; score: number }> = []

  if (isEmbeddingReady()) {
    try {
      const queryEmbedding = await getEmbedding(query)
      vectorResults = kb.searchByVector(queryEmbedding, limit * 2)
    } catch (err) {
      console.warn('[Knowledge] Vector search failed, falling back to BM25 only:', err)
    }
  }

  if (vectorResults.length === 0) {
    return bm25Results.slice(0, limit)
  }

  // RRF 融合: score = sum(1 / (k + rank_i)), k=60
  const RRF_K = 60
  const rrfScores = new Map<string, { content: string; documentId: string; fileName: string; score: number }>()

  bm25Results.forEach((r, idx) => {
    const key = `${r.document_id}:${r.content.substring(0, 50)}`
    const existing = rrfScores.get(key)
    const rrfContribution = 1 / (RRF_K + idx + 1)
    if (existing) {
      existing.score += rrfContribution
    } else {
      rrfScores.set(key, { content: r.content, documentId: r.document_id, fileName: r.file_name, score: rrfContribution })
    }
  })

  vectorResults.forEach((r, idx) => {
    const key = `${r.documentId}:${r.content.substring(0, 50)}`
    const rrfContribution = 1 / (RRF_K + idx + 1)
    const existing = rrfScores.get(key)
    if (existing) {
      existing.score += rrfContribution
    } else {
      rrfScores.set(key, { content: r.content, documentId: r.documentId, fileName: kb.getFileName(r.documentId), score: rrfContribution })
    }
  })

  return Array.from(rrfScores.values())
    .map((r) => ({ content: r.content, document_id: r.documentId, file_name: r.fileName, score: r.score }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}

// 为已有文本块生成向量嵌入（当前不可用，保留接口）
async function generateEmbeddingsForDocument(docId: string): Promise<void> {
  if (!isEmbeddingReady()) return
  const chunks = kb.getChunksWithoutEmbedding(docId)
  for (const chunk of chunks) {
    try {
      const embedding = await getEmbedding(chunk.content)
      kb.addChunkEmbedding(chunk.id, embedding)
    } catch (err) {
      console.warn(`[Knowledge] Failed to embed chunk ${chunk.id}:`, err)
    }
  }
}

// RAG 上下文总长度上限：防命中过多撑爆 prompt
const MAX_RAG_CONTEXT_LENGTH = 6000

// 将搜索结果格式化为 RAG 上下文文本
export function formatRagContext(results: Array<SearchResult>): string {
  if (results.length === 0) return ''
  const text = results
    .map((r, i) => `[来源${i + 1}: ${r.file_name}]\n${r.content}`)
    .join('\n\n---\n\n')
  if (text.length <= MAX_RAG_CONTEXT_LENGTH) return text
  return text.substring(0, MAX_RAG_CONTEXT_LENGTH) + '\n\n...(更多检索结果已省略)'
}

// 把存成 JSON 字符串的 tags 列解析为 string[]，强制把每个元素规整为字符串
// （对象取 name/id/label/value），避免脏数据导致前端渲染崩溃。
function parseTagStrings(tagsJson: string | null | undefined): string[] {
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
        : (() => { try { return JSON.stringify(o) } catch { return '[object]' } })()
    } else {
      s = v == null ? '' : String(v)
    }
    s = s.trim()
    if (s.length > 0) out.push(s)
  }
  return out
}

// 文档行 → IPC 传输对象（tags 解析为 string[]）
// 注意：历史/导入数据里个别 tag 可能存成了对象（如 { name: "气动" }），
// 直接 JSON.parse 出来 .map 渲染会触发 React 致命错误，这里强制规整为字符串。
function docToPayload(row: kb.KbDocumentRow): Record<string, unknown> {
  const tags = parseTagStrings(row.tags)
  return {
    id: row.id,
    file_path: row.file_path,
    file_name: row.file_name,
    file_type: row.file_type,
    domain_category: row.domain_category,
    tags,
    index_status: row.index_status,
    chunk_count: row.chunk_count,
    file_size: row.file_size,
    added_at: row.added_at,
    indexed_at: row.indexed_at
  }
}

export function registerKnowledgeIPC(mainWindow: BrowserWindow): void {
  // 列出所有文档
  ipcMain.handle('kb:listDocuments', async () => {
    return kb.listDocuments().map(docToPayload)
  })

  // 选择导入路径（文件 + 文件夹，可多选）
  ipcMain.handle('kb:pickImportPaths', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'openDirectory', 'multiSelections'],
      filters: [
        { name: '支持的文档', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'csv', 'txt', 'md', 'dat', 'json', 'png', 'jpg', 'jpeg'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled) return []
    return result.filePaths
  })

  // 批量导入（支持文件夹递归、sha256 去重、标签、进度事件 kb:importProgress）
  // 分类由用户指定，不再自动解析
  ipcMain.handle('kb:importPaths', async (event, paths: string[], tags?: string[], domain?: string): Promise<ImportSummary> => {
    if (!Array.isArray(paths) || paths.length === 0) {
      return { total: 0, done: 0, skipped: 0, error: 0, results: [] }
    }
    const cleanTags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter((t) => t.length > 0) : []
    const cleanDomain = typeof domain === 'string' ? domain.trim() : ''
    return startImport(paths, cleanTags, cleanDomain, event.sender)
  })

  // 兼容旧入口：文件对话框 + 无标签导入
  ipcMain.handle('kb:uploadDocuments', async (event) => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文档', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'csv', 'txt', 'md', 'dat', 'json', 'png', 'jpg', 'jpeg'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return []
    const summary = await startImport(result.filePaths, [], '', event.sender)
    return summary.results
      .filter((r) => r.status === 'done')
      .map((r) => ({ id: r.docId, file_name: r.fileName, chunk_count: r.chunkCount }))
  })

  ipcMain.handle('kb:importStatus', async () => {
    return { running: isImportRunning() }
  })

  // 搜索知识库（可选标签过滤）
  ipcMain.handle('kb:search', async (_event, query: string, limit?: number, tags?: string[]) => {
    return searchChunks(query, limit || 10, tags)
  })

  // 语义搜索（混合检索）
  ipcMain.handle('kb:semanticSearch', async (_event, query: string, options?: { domain?: string; limit?: number; tags?: string[] }) => {
    return hybridSearch(query, options)
  })

  // 获取嵌入模型状态
  ipcMain.handle('kb:embeddingStatus', async () => {
    return isEmbeddingReady()
  })

  // 为已有文档生成嵌入
  ipcMain.handle('kb:generateEmbeddings', async () => {
    if (!isEmbeddingReady()) return { success: false, error: 'Embedding model not ready' }
    const docs = kb.listDoneDocuments()
    let embedded = 0
    for (const doc of docs) {
      try {
        await generateEmbeddingsForDocument(doc.id)
        embedded++
      } catch (err) {
        console.warn(`[Knowledge] Embedding generation failed for ${doc.file_name}:`, err)
      }
    }
    return { success: true, embedded }
  })

  // 删除文档
  ipcMain.handle('kb:deleteDocument', async (_event, docId: string) => {
    kb.deleteDocument(docId)
    return { success: true }
  })

  // 批量删除文档
  ipcMain.handle('kb:deleteDocuments', async (_event, docIds: string[]) => {
    if (!Array.isArray(docIds)) return { success: false, deleted: 0 }
    const ids = docIds.filter((id) => typeof id === 'string' && id.length > 0)
    kb.deleteDocuments(ids)
    return { success: true, deleted: ids.length }
  })

  // 更新文档标签
  ipcMain.handle('kb:updateTags', async (_event, docId: string, tags: string[]) => {
    const cleanTags = Array.isArray(tags) ? tags.map((t) => String(t).trim()).filter((t) => t.length > 0) : []
    kb.updateDocumentTags(docId, cleanTags)
    return { success: true }
  })

  ipcMain.handle('kb:updateDomain', async (_event, docId: string, domain: string) => {
    kb.updateDocumentDomain(docId, typeof domain === 'string' ? domain : '')
    return { success: true }
  })

  // 所有已使用标签
  ipcMain.handle('kb:tags', async () => {
    return kb.listAllTags()
  })

  // 获取文档统计（含库文件体积）
  ipcMain.handle('kb:stats', async () => {
    const stats = kb.getStats()
    let dbSizeBytes = 0
    const dbPath = kb.getKbDbPath()
    if (dbPath) {
      try {
        dbSizeBytes = fs.statSync(dbPath).size
      } catch { /* ignore */ }
    }
    return { ...stats, dbSizeBytes }
  })

  // 获取分类列表
  ipcMain.handle('kb:categories', async () => {
    return kb.listCategories()
  })

  // 按分类列出文档
  ipcMain.handle('kb:listByCategory', async (_event, category: string) => {
    return kb.listDocuments(category).map(docToPayload)
  })

  // 向知识库提问（检索相关内容后交给LLM回答）
  // GraphRAG 增强：当图谱实体存在时，用实体匹配补充检索结果
  ipcMain.handle('kb:ask', async (_event, question: string, tags?: string[]) => {
    const baseResults = await hybridSearch(question, { limit: 5, tags }).catch(() => searchChunks(question, 5, tags))
    const searchResults = await enhanceSearchWithGraph(question, baseResults, 5)
    if (searchResults.length === 0) return { answer: '未找到相关知识库内容。', sources: [] }

    const ragContext = formatRagContext(searchResults)
    const sources = searchResults.map((r) => ({ file_name: r.file_name, snippet: r.content.substring(0, 100) }))

    try {
      const llm = createChatModel()
      const chunks: string[] = []
      const stream = streamChat(llm, {
        systemPrompt: '你是临智LINZ的知识库问答助手。请严格基于提供的知识库参考内容回答用户问题。如果参考内容不足以回答，请明确说明。回答时标注信息来源文件名。',
        userMessage: question,
        ragContext
      })
      for await (const chunk of stream) {
        if (typeof chunk === 'string') chunks.push(chunk)
      }
      return { answer: chunks.join(''), sources }
    } catch (err: any) {
      return { answer: `检索到 ${searchResults.length} 条相关内容，但生成回答失败: ${err.message}`, sources }
    }
  })

  // ============ 知识图谱 ============

  // 构建图谱：相似度层（本地计算，一次返回全量带 weight 的候选边）+ 可选叠加 LLM 实体层
  // 阈值过滤在前端做显隐切换，这里不传 threshold
  ipcMain.handle('kb:graph:build', async (_event, options?: { includeEntities?: boolean }) => {
    return buildGraph({
      includeEntities: options?.includeEntities !== false
    })
  })

  // 文档原文片段（节点详情"查看原文"）
  ipcMain.handle('kb:graph:docChunks', async (_event, docId: string, limit?: number) => {
    if (typeof docId !== 'string' || !docId) return []
    return kb.getDocumentChunks(docId, typeof limit === 'number' ? limit : 20)
  })

  // LLM 实体/关系抽取（逐文档，进度推 kb:graph:enrichProgress）
  ipcMain.handle('kb:graph:llmEnrich', async (event, docIds: string[]) => {
    if (!Array.isArray(docIds) || docIds.length === 0) {
      return { done: 0, skipped: 0, failed: 0, entityCount: 0 }
    }
    const ids = docIds.filter((id) => typeof id === 'string' && id.length > 0)
    return enrichDocuments(ids, (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('kb:graph:enrichProgress', p)
    })
  })

  // 清除 AI 增强层（指定文档或全部）
  ipcMain.handle('kb:graph:clearEnrichment', async (_event, docIds?: string[]) => {
    const ids = Array.isArray(docIds) ? docIds.filter((id) => typeof id === 'string' && id.length > 0) : undefined
    kb.clearGraphEnrichment(ids)
    return { success: true }
  })

  // 图谱内嵌问答：限定文档集合的 RAG
  ipcMain.handle('kb:graph:ask', async (_event, question: string, docIds: string[]) => {
    if (typeof question !== 'string' || !question.trim()) return { answer: '请输入问题。', sources: [] }
    if (!Array.isArray(docIds) || docIds.length === 0) return { answer: '请先在图谱中选择至少一个文档节点。', sources: [] }
    const ids = docIds.filter((id) => typeof id === 'string' && id.length > 0)

    const searchResults = kb.searchInDocs(question, ids, 6)
    if (searchResults.length === 0) return { answer: '所选文档中未找到与问题相关的内容。', sources: [] }

    const ragContext = formatRagContext(searchResults)
    const sources = searchResults.map((r) => ({ file_name: r.file_name, snippet: r.content.substring(0, 100) }))

    try {
      const llm = createChatModel()
      const chunks: string[] = []
      const stream = streamChat(llm, {
        systemPrompt: '你是临智LINZ的知识库问答助手。请严格基于提供的知识库参考内容回答用户问题。如果参考内容不足以回答，请明确说明。回答时标注信息来源文件名。',
        userMessage: question,
        ragContext
      })
      for await (const chunk of stream) {
        if (typeof chunk === 'string') chunks.push(chunk)
      }
      return { answer: chunks.join(''), sources }
    } catch (err: any) {
      return { answer: `检索到 ${searchResults.length} 条相关内容，但生成回答失败: ${err.message}`, sources }
    }
  })

  // GraphRAG：按查询搜索图谱实体+关系+关联文档片段（供 UI / Agent 调用）
  ipcMain.handle('kb:graph:searchEntities', async (_event, query: string) => {
    if (typeof query !== 'string' || !query.trim()) {
      return { entities: [], relations: [], chunks: [] }
    }
    return graphSearch(query.trim())
  })

  // ============ Wiki 知识图谱 ============

  // 生成 Wiki（逐实体 LLM 生成，进度推 kb:wiki:progress）
  ipcMain.handle('kb:wiki:generate', async (event) => {
    const result = await generateWiki((p) => {
      if (!event.sender.isDestroyed()) event.sender.send('kb:wiki:progress', p)
    })
    return result
  })

  // 获取链接图谱（overview / ego 模式）
  ipcMain.handle('kb:wiki:getGraph', async (_event, options?: { mode?: string; center?: string; depth?: number; limit?: number; types?: string[] }) => {
    return getWikiGraph({
      mode: (options?.mode as 'overview' | 'ego') || 'overview',
      center: options?.center,
      depth: options?.depth,
      limit: options?.limit,
      types: options?.types
    })
  })

  // 获取单个页面内容
  ipcMain.handle('kb:wiki:getPage', async (_event, slug: string) => {
    if (typeof slug !== 'string' || !slug) return null
    const page = kb.getWikiPage(slug)
    if (!page) return null
    let inLinks: string[] = []
    let outLinks: string[] = []
    let sourceRefs: string[] = []
    let chunkRefs: string[] = []
    try { inLinks = JSON.parse(page.in_links || '[]') } catch { /* ignore */ }
    try { outLinks = JSON.parse(page.out_links || '[]') } catch { /* ignore */ }
    try { sourceRefs = JSON.parse(page.source_refs || '[]') } catch { /* ignore */ }
    try { chunkRefs = JSON.parse(page.chunk_refs || '[]') } catch { /* ignore */ }
    return {
      id: page.id,
      slug: page.slug,
      title: page.title,
      pageType: page.page_type,
      content: page.content,
      summary: page.summary,
      inLinks,
      outLinks,
      sourceRefs,
      chunkRefs
    }
  })

  // 列出所有页面摘要
  ipcMain.handle('kb:wiki:listPages', async () => {
    return kb.listWikiPages()
  })

  // 删除所有 Wiki 页面
  ipcMain.handle('kb:wiki:deleteAll', async () => {
    kb.deleteAllWikiPages()
    return { success: true }
  })

  // Wiki 状态检查
  ipcMain.handle('kb:wiki:status', async () => {
    const count = kb.countWikiPages()
    return { hasWiki: count > 0, pageCount: count }
  })
}
