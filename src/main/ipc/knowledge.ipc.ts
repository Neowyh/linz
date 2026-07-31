import { ipcMain, BrowserWindow, dialog } from 'electron'
import fs from 'fs'
import { getEmbedding, isEmbeddingReady } from '../embedding'
import { createChatModel } from '../llm'
import { streamChat } from '../llm/stream-handler'
import * as kb from '../database/kb'
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

// 文档行 → IPC 传输对象（tags 解析为数组）
function docToPayload(row: kb.KbDocumentRow): Record<string, unknown> {
  let tags: string[] = []
  try {
    tags = JSON.parse(row.tags || '[]')
  } catch { /* ignore */ }
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
  ipcMain.handle('kb:ask', async (_event, question: string, tags?: string[]) => {
    const searchResults = await hybridSearch(question, { limit: 5, tags }).catch(() => searchChunks(question, 5, tags))
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
}
