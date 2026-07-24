import { ipcMain, BrowserWindow, dialog } from 'electron'
import { getDatabase, debounceSave, addChunkEmbedding, searchByVector } from '../database'
import { v4 as uuidv4 } from 'uuid'
import { getEmbedding, isEmbeddingReady } from '../embedding'
import { parseFile } from '../parsers'
import { createChatModel } from '../llm'
import { streamChat } from '../llm/stream-handler'
import fs from 'fs'
import path from 'path'

// 转义正则表达式特殊字符
export function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 简单的中文+英文文本分块
export function chunkText(text: string, chunkSize = 500, overlap = 100): string[] {
  if (!text || text.trim().length === 0) return []
  const step = chunkSize - overlap
  if (step <= 0) return [text.substring(0, chunkSize)] // overlap >= chunkSize 时避免死循环
  const chunks: string[] = []
  let start = 0
  while (start < text.length) {
    const end = Math.min(start + chunkSize, text.length)
    chunks.push(text.substring(start, end))
    start += step
    if (start >= text.length) break
  }
  return chunks
}

// 文本提取：复用 parsers 模块支持 PDF/Word/Excel/CSV 等
export async function extractText(filePath: string): Promise<string> {
  const ext = path.extname(filePath).toLowerCase()

  // 纯文本格式直接读取，无需异步解析
  if (['.txt', '.md', '.dat'].includes(ext)) {
    return fs.readFileSync(filePath).toString('utf-8')
  }
  if (ext === '.json') {
    try { return JSON.stringify(JSON.parse(fs.readFileSync(filePath).toString('utf-8')), null, 2) } catch { return fs.readFileSync(filePath).toString('utf-8') }
  }

  // PDF/Word/Excel/CSV 等使用 parsers 模块解析
  const parsed = await parseFile(filePath)
  if (parsed.error) {
    console.warn(`[Knowledge] Failed to parse ${filePath}: ${parsed.error}`)
    return ''
  }
  return parsed.content
}

// 根据内容猜测领域分类
export function guessDomain(content: string): string {
  const domainKeywords: Record<string, string[]> = {
    '气动分析': ['翼型', '升力', '阻力', '马赫数', '气动', 'CFD', '迎角', '展弦比'],
    '结构强度': ['结构', '强度', '材料', '载荷', '疲劳', '复合材料', '有限元'],
    '推进设计': ['发动机', '推力', '燃油', '推进', '涡扇', '螺旋桨'],
    '航电控制': ['航电', '飞控', '传感器', '通信', '导航', 'GPS'],
    '总体设计': ['总体', '起飞重量', '航程', '载重', '布局'],
    '标准规范': ['GJB', '规范', '标准', '要求', '条款', '合格']
  }
  for (const [domain, keywords] of Object.entries(domainKeywords)) {
    if (keywords.some((kw) => content.includes(kw))) return domain
  }
  return '未分类'
}

export interface SearchResult {
  content: string
  document_id: string
  file_name: string
  score: number
}

// 飞行器设计中英文术语对照表
const AERO_TERMS: Record<string, string[]> = {
  // 气动
  '升力': ['lift'], '阻力': ['drag'], '升阻比': ['lift-to-drag', 'l/d'], '气动': ['aerodynamic', 'aero'],
  '翼型': ['airfoil'], '机翼': ['wing'], '迎角': ['angle of attack', 'aoa'],
  '后掠角': ['sweep angle'], '展弦比': ['aspect ratio'], '翼展': ['wingspan', 'span'],
  '马赫数': ['mach number', 'mach'], '雷诺数': ['reynolds number', 're'],
  '失速': ['stall'], '激波': ['shock wave'], '边界层': ['boundary layer'],
  '湍流': ['turbulence', 'turbulent'], '层流': ['laminar'],
  '压力分布': ['pressure distribution'], '俯仰力矩': ['pitching moment'],
  '巡航': ['cruise'], '螺旋桨': ['propeller'], '涡流': ['vortex'],
  '推重比': ['thrust-to-weight'], '动压': ['dynamic pressure'],
  '升力系数': ['lift coefficient', 'cl'], '阻力系数': ['drag coefficient', 'cd'],
  '俯仰力矩系数': ['pitching moment coefficient', 'cm'],
  '尖削比': ['taper ratio'], '根梢比': ['taper ratio'],
  '上反角': ['dihedral angle'], '下反角': ['anhedral angle'],
  '前缘': ['leading edge'], '后缘': ['trailing edge'],
  '上表面': ['upper surface'], '下表面': ['lower surface'],
  '压力中心': ['center of pressure'], '气动中心': ['aerodynamic center'],
  '诱导阻力': ['induced drag'], '寄生阻力': ['parasite drag'],
  '波阻': ['wave drag'], '摩擦阻力': ['skin friction drag'],
  // 结构
  '结构': ['structural', 'structure'], '强度': ['strength'], '刚度': ['stiffness', 'rigidity'],
  '疲劳': ['fatigue'], '载荷': ['load'], '复合材料': ['composite'],
  '铝合金': ['aluminum alloy'], '钛合金': ['titanium alloy'],
  '铺层': ['ply', 'laminate'], '连接件': ['fastener', 'joint'],
  '有限元': ['finite element', 'fem'], '拓扑优化': ['topology optimization'],
  '应力': ['stress'], '应变': ['strain'], '屈曲': ['buckling'],
  '蒙皮': ['skin'], '翼梁': ['spar'], '翼肋': ['rib'],
  '框': ['frame', 'bulkhead'], '桁条': ['stringer'],
  // 推进
  '推进': ['propulsion'], '发动机': ['engine', 'motor'],
  '推力': ['thrust'], '燃油': ['fuel'], '涡扇': ['turbofan'],
  '活塞': ['piston'], '电机': ['electric motor', 'motor'],
  '耗油率': ['specific fuel consumption', 'sfc'],
  '桨盘': ['propeller disk'], '电池': ['battery'],
  '涵道比': ['bypass ratio'], '压气机': ['compressor'],
  '涡轮': ['turbine'], '燃烧室': ['combustor', 'combustion chamber'],
  // 航电
  '航电': ['avionics'], '飞控': ['flight control', 'fcs'],
  '传感器': ['sensor'], '通信': ['communication'],
  '导航': ['navigation'], '电气': ['electrical'],
  '电磁': ['electromagnetic'], '天线': ['antenna'],
  '惯性导航': ['inertial navigation', 'ins'], 'gps': ['gps', 'global positioning'],
  '自动驾驶': ['autopilot'], '遥测': ['telemetry'],
  // 仿真
  '仿真': ['simulation'], '网格': ['mesh', 'grid'],
  '求解器': ['solver'], '后处理': ['post-processing'], '前处理': ['pre-processing'],
  '湍流模型': ['turbulence model'], '边界条件': ['boundary condition'],
  '收敛': ['convergence'], '残差': ['residual'],
  '计算域': ['computational domain'], '网格划分': ['meshing'],
  // 文档
  '报告': ['report'], '文档': ['document', 'documentation'],
  '规范': ['specification', 'standard'], '标准': ['standard'],
  '评审': ['review'], '综述': ['review', 'survey'],
  // 通用
  '飞行器': ['aircraft', 'vehicle'], '飞机': ['aircraft', 'airplane'],
  '无人机': ['uav', 'drone', 'unmanned aerial vehicle'],
  '设计': ['design'], '优化': ['optimization'],
  '重量': ['weight'], '重心': ['center of gravity', 'cg'],
  '航程': ['range'], '升限': ['ceiling'],
  '起飞': ['takeoff'], '着陆': ['landing'],
  '速度': ['velocity', 'speed'], '高度': ['altitude'],
  '温度': ['temperature'], '湿度': ['humidity'],
}

// 反向映射：英文 -> 中文
const REVERSE_TERMS: Record<string, string[]> = {}
for (const [zh, enList] of Object.entries(AERO_TERMS)) {
  for (const en of enList) {
    const key = en.toLowerCase()
    if (!REVERSE_TERMS[key]) REVERSE_TERMS[key] = []
    if (!REVERSE_TERMS[key].includes(zh)) REVERSE_TERMS[key].push(zh)
  }
}

// 查询扩展：根据中英文术语对照扩展搜索词，返回带权重的词表
interface WeightedTerm { term: string; weight: number }
function expandQueryTerms(terms: string[]): WeightedTerm[] {
  const termMap = new Map<string, number>() // term -> max weight
  for (const term of terms) {
    // 原词权重 1.0
    const existing = termMap.get(term) || 0
    termMap.set(term, Math.max(existing, 1.0))
    const lower = term.toLowerCase()
    // 中文查英文（扩展词权重 0.5）
    if (AERO_TERMS[term]) {
      for (const en of AERO_TERMS[term]) {
        const enLower = en.toLowerCase()
        termMap.set(enLower, Math.max(termMap.get(enLower) || 0, 0.5))
      }
    }
    // 英文查中文（扩展词权重 0.5）
    if (REVERSE_TERMS[lower]) {
      for (const zh of REVERSE_TERMS[lower]) {
        termMap.set(zh, Math.max(termMap.get(zh) || 0, 0.5))
      }
    }
    // 部分匹配：术语表中的键包含搜索词（权重 0.3）
    for (const [zh, enList] of Object.entries(AERO_TERMS)) {
      if (zh.includes(term) && zh !== term) {
        termMap.set(zh, Math.max(termMap.get(zh) || 0, 0.3))
      }
      for (const en of enList) {
        if (en.toLowerCase().includes(lower) && en.toLowerCase() !== lower) {
          termMap.set(en.toLowerCase(), Math.max(termMap.get(en.toLowerCase()) || 0, 0.3))
        }
      }
    }
  }
  return Array.from(termMap.entries()).map(([term, weight]) => ({ term, weight }))
}

// BM25风格的关键词搜索（支持中英文术语扩展）
export function searchChunks(query: string, limit = 10): Array<SearchResult> {
  const db = getDatabase()
  const rawTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  if (rawTerms.length === 0) return []

  // 中英文术语扩展
  const terms = expandQueryTerms(rawTerms)

  // 获取所有文本块
  const chunksResult = db.exec('SELECT id, document_id, content FROM kb_chunks')
  if (!chunksResult[0]) return []

  const docsResult = db.exec('SELECT id, file_name FROM kb_documents')
  const docNames = new Map<string, string>()
  if (docsResult[0]) {
    docsResult[0].values.forEach((row) => { docNames.set(row[0] as string, row[1] as string) })
  }

  const scored: Array<SearchResult> = []

  for (const row of chunksResult[0].values) {
    const content = (row[2] as string).toLowerCase()
    let score = 0
    for (const { term, weight } of terms) {
      const count = (content.match(new RegExp(escapeRegex(term), 'g')) || []).length
      score += count * weight
    }
    if (score > 0) {
      scored.push({
        content: row[2] as string,
        document_id: row[1] as string,
        file_name: docNames.get(row[1] as string) || '未知文件',
        score
      })
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit)
}

// 高级知识库检索函数，供 Agent 直接调用（无需 IPC）
export function searchKnowledgeBase(
  query: string,
  options?: { domain?: string; limit?: number }
): Array<SearchResult> {
  let results = searchChunks(query, options?.limit || 5)

  if (options?.domain && options.domain !== '未分类') {
    const db = getDatabase()
    const docResult = db.exec('SELECT id FROM kb_documents WHERE domain_category = ?', [options.domain])
    const domainDocIds = new Set<string>()
    if (docResult[0]) {
      docResult[0].values.forEach((row) => domainDocIds.add(row[0] as string))
    }
    results = results.filter((r) => domainDocIds.has(r.document_id))
  }

  return results
}

// 混合检索：BM25 + 向量语义 → RRF 融合重排
export async function hybridSearch(
  query: string,
  options?: { domain?: string; limit?: number }
): Promise<Array<SearchResult>> {
  const limit = options?.limit || 5
  const bm25Results = searchChunks(query, limit * 2)
  let vectorResults: Array<{ chunkId: string; documentId: string; content: string; score: number }> = []

  // 尝试向量搜索
  if (isEmbeddingReady()) {
    try {
      const queryEmbedding = await getEmbedding(query)
      vectorResults = searchByVector(queryEmbedding, limit * 2)
    } catch (err) {
      console.warn('[Knowledge] Vector search failed, falling back to BM25 only:', err)
    }
  }

  // 如果没有向量结果，直接返回 BM25 结果
  if (vectorResults.length === 0) {
    let results = bm25Results.slice(0, limit)
    if (options?.domain && options.domain !== '未分类') {
      const db = getDatabase()
      const docResult = db.exec('SELECT id FROM kb_documents WHERE domain_category = ?', [options.domain])
      const domainDocIds = new Set<string>()
      if (docResult[0]) {
        docResult[0].values.forEach((row) => domainDocIds.add(row[0] as string))
      }
      results = results.filter((r) => domainDocIds.has(r.document_id))
    }
    return results
  }

  // 获取文档名映射
  const db = getDatabase()
  const docsResult = db.exec('SELECT id, file_name FROM kb_documents')
  const docNames = new Map<string, string>()
  if (docsResult[0]) {
    docsResult[0].values.forEach((row) => { docNames.set(row[0] as string, row[1] as string) })
  }

  // RRF 融合: score = sum(1 / (k + rank_i)), k=60
  const RRF_K = 60
  const rrfScores = new Map<string, { content: string; documentId: string; score: number }>()

  bm25Results.forEach((r, idx) => {
    const key = `${r.document_id}:${r.content.substring(0, 50)}`
    const existing = rrfScores.get(key)
    const rrfContribution = 1 / (RRF_K + idx + 1)
    if (existing) {
      existing.score += rrfContribution
    } else {
      rrfScores.set(key, { content: r.content, documentId: r.document_id, score: rrfContribution })
    }
  })

  vectorResults.forEach((r, idx) => {
    const key = `${r.documentId}:${r.content.substring(0, 50)}`
    const rrfContribution = 1 / (RRF_K + idx + 1)
    const existing = rrfScores.get(key)
    if (existing) {
      existing.score += rrfContribution
    } else {
      rrfScores.set(key, { content: r.content, documentId: r.documentId, score: rrfContribution })
    }
  })

  let fusedResults = Array.from(rrfScores.values())
    .map((r) => ({
      content: r.content,
      document_id: r.documentId,
      file_name: docNames.get(r.documentId) || '未知文件',
      score: r.score
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  if (options?.domain && options.domain !== '未分类') {
    const docResult = db.exec('SELECT id FROM kb_documents WHERE domain_category = ?', [options.domain])
    const domainDocIds = new Set<string>()
    if (docResult[0]) {
      docResult[0].values.forEach((row) => domainDocIds.add(row[0] as string))
    }
    fusedResults = fusedResults.filter((r) => domainDocIds.has(r.document_id))
  }

  return fusedResults
}

// 为已有文本块生成向量嵌入
async function generateEmbeddingsForDocument(docId: string): Promise<void> {
  if (!isEmbeddingReady()) return

  const db = getDatabase()
  const chunks = db.exec('SELECT id, content FROM kb_chunks WHERE document_id = ? AND embedding IS NULL', [docId])
  if (!chunks[0]) return

  for (const row of chunks[0].values) {
    const chunkId = row[0] as string
    const content = row[1] as string
    try {
      const embedding = await getEmbedding(content)
      addChunkEmbedding(chunkId, embedding)
    } catch (err) {
      console.warn(`[Knowledge] Failed to embed chunk ${chunkId}:`, err)
    }
  }
}

// 将搜索结果格式化为 RAG 上下文文本
export function formatRagContext(results: Array<SearchResult>): string {
  if (results.length === 0) return ''
  return results
    .map((r, i) => `[来源${i + 1}: ${r.file_name}]\n${r.content}`)
    .join('\n\n---\n\n')
}

export function registerKnowledgeIPC(mainWindow: BrowserWindow): void {
  // 列出所有文档
  ipcMain.handle('kb:listDocuments', async () => {
    const db = getDatabase()
    const results = db.exec('SELECT * FROM kb_documents ORDER BY added_at DESC')
    if (!results[0]) return []
    return results[0].values.map((row) => ({
      id: row[0], file_path: row[1], file_name: row[2], file_type: row[3],
      domain_category: row[4], index_status: row[5], chunk_count: row[6],
      file_size: row[7], added_at: row[8], indexed_at: row[9]
    }))
  })

  // 上传并索引文档
  ipcMain.handle('kb:uploadDocuments', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '支持的文档', extensions: ['pdf', 'docx', 'doc', 'xlsx', 'csv', 'txt', 'md', 'dat', 'json', 'png', 'jpg', 'jpeg'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    })

    if (result.canceled || result.filePaths.length === 0) return []

    const db = getDatabase()
    const indexed = []

    for (const filePath of result.filePaths) {
      const fileName = path.basename(filePath)
      const ext = path.extname(filePath).toLowerCase()
      const stats = fs.statSync(filePath)
      const docId = uuidv4()

      // 插入文档记录
      db.run(
        `INSERT INTO kb_documents (id, file_path, file_name, file_type, file_size, index_status) VALUES (?, ?, ?, ?, ?, ?)`,
        [docId, filePath, fileName, ext.replace('.', ''), stats.size, 'indexing']
      )

      try {
        // 提取文本（异步，支持 PDF/Word/Excel）
        const text = await extractText(filePath)
        if (!text || text.trim().length === 0) {
          db.run('UPDATE kb_documents SET index_status = ? WHERE id = ?', ['error', docId])
          continue
        }

        // 猜测领域
        const domain = guessDomain(text.substring(0, 2000))

        // 分块
        const chunks = chunkText(text)

        // 存储文本块
        for (let i = 0; i < chunks.length; i++) {
          const chunkId = uuidv4()
          db.run(
            'INSERT INTO kb_chunks (id, document_id, content, chunk_index) VALUES (?, ?, ?, ?)',
            [chunkId, docId, chunks[i], i]
          )
        }

        // 更新文档状态
        db.run(
          'UPDATE kb_documents SET domain_category = ?, index_status = ?, chunk_count = ?, indexed_at = datetime("now") WHERE id = ?',
          [domain, 'done', chunks.length, docId]
        )

        indexed.push({
          id: docId, file_name: fileName, file_type: ext.replace('.', ''),
          domain_category: domain, chunk_count: chunks.length, file_size: stats.size
        })

        // 异步生成向量嵌入（不阻塞上传流程）
        generateEmbeddingsForDocument(docId).catch((err) => {
          console.warn(`[Knowledge] Background embedding failed for ${fileName}:`, err)
        })
      } catch (err: any) {
        db.run('UPDATE kb_documents SET index_status = ? WHERE id = ?', ['error', docId])
      }
    }

    debounceSave()
    return indexed
  })

  // 搜索知识库
  ipcMain.handle('kb:search', async (_event, query: string, limit?: number) => {
    return searchChunks(query, limit || 10)
  })

  // 语义搜索（混合检索）
  ipcMain.handle('kb:semanticSearch', async (_event, query: string, options?: { domain?: string; limit?: number }) => {
    return hybridSearch(query, options)
  })

  // 获取嵌入模型状态
  ipcMain.handle('kb:embeddingStatus', async () => {
    return isEmbeddingReady()
  })

  // 为已有文档生成嵌入
  ipcMain.handle('kb:generateEmbeddings', async () => {
    if (!isEmbeddingReady()) return { success: false, error: 'Embedding model not ready' }
    const db = getDatabase()
    const docs = db.exec('SELECT id, file_name FROM kb_documents WHERE index_status = ?', ['done'])
    if (!docs[0]) return { success: true, embedded: 0 }

    let embedded = 0
    for (const row of docs[0].values) {
      try {
        await generateEmbeddingsForDocument(row[0] as string)
        embedded++
      } catch (err) {
        console.warn(`[Knowledge] Embedding generation failed for ${row[1]}:`, err)
      }
    }
    return { success: true, embedded }
  })

  // 删除文档
  ipcMain.handle('kb:deleteDocument', async (_event, docId: string) => {
    const db = getDatabase()
    db.run('DELETE FROM kb_chunks WHERE document_id = ?', [docId])
    db.run('DELETE FROM kb_documents WHERE id = ?', [docId])
    debounceSave()
    return { success: true }
  })

  // 获取文档统计
  ipcMain.handle('kb:stats', async () => {
    const db = getDatabase()
    const docCount = db.exec('SELECT COUNT(*) FROM kb_documents')
    const chunkCount = db.exec('SELECT COUNT(*) FROM kb_chunks')
    const categoryCount = db.exec('SELECT domain_category, COUNT(*) as cnt FROM kb_documents GROUP BY domain_category')
    return {
      totalDocuments: docCount[0]?.values[0]?.[0] || 0,
      totalChunks: chunkCount[0]?.values[0]?.[0] || 0,
      categories: categoryCount[0]?.values.map((r) => ({ category: r[0], count: r[1] })) || []
    }
  })

  // 获取分类列表
  ipcMain.handle('kb:categories', async () => {
    const db = getDatabase()
    const results = db.exec('SELECT DISTINCT domain_category FROM kb_documents')
    if (!results[0]) return ['全部']
    return ['全部', ...results[0].values.map((r) => r[0] as string)]
  })

  // 按分类列出文档
  ipcMain.handle('kb:listByCategory', async (_event, category: string) => {
    const db = getDatabase()
    if (!category || category === '全部') {
      const results = db.exec('SELECT * FROM kb_documents ORDER BY added_at DESC')
      if (!results[0]) return []
      return results[0].values.map((row) => ({
        id: row[0], file_path: row[1], file_name: row[2], file_type: row[3],
        domain_category: row[4], index_status: row[5], chunk_count: row[6],
        file_size: row[7], added_at: row[8], indexed_at: row[9]
      }))
    }
    const results = db.exec('SELECT * FROM kb_documents WHERE domain_category = ? ORDER BY added_at DESC', [category])
    if (!results[0]) return []
    return results[0].values.map((row) => ({
      id: row[0], file_path: row[1], file_name: row[2], file_type: row[3],
      domain_category: row[4], index_status: row[5], chunk_count: row[6],
      file_size: row[7], added_at: row[8], indexed_at: row[9]
    }))
  })

  // 向知识库提问（检索相关内容后交给LLM回答）
  ipcMain.handle('kb:ask', async (_event, question: string) => {
    const searchResults = await hybridSearch(question, { limit: 5 }).catch(() => searchChunks(question, 5))
    if (searchResults.length === 0) return { answer: '未找到相关知识库内容。', sources: [] }

    const ragContext = searchResults.map((r, i) => `[来源${i + 1}: ${r.file_name}]\n${r.content}`).join('\n\n---\n\n')
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
