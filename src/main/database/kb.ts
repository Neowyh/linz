import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { Database as SqlJsDatabase } from 'sql.js'

// ============ CJK bigram 分词（FTS5 中文检索的核心） ============
// trigram 分词器对 2 字中文词（机翼/安保/雷达）完全无法匹配，实测不可用。
// 改为经典 CJK bigram 方案：连续汉字切成重叠二字组，拉丁字母/数字保持整词，
// 索引与查询两侧走同一分词函数，最终都经 FTS5 unicode61 落词，语义一致。

const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/
const LATIN_RE = /[A-Za-z0-9_.-]/

export function toBigramTokens(text: string): string[] {
  const tokens: string[] = []
  let latin = ''
  let cjk: string[] = []
  const flushLatin = (): void => {
    if (latin) {
      tokens.push(latin.toLowerCase())
      latin = ''
    }
  }
  const flushCjk = (): void => {
    if (cjk.length === 1) {
      tokens.push(cjk[0])
    } else {
      for (let i = 0; i < cjk.length - 1; i++) tokens.push(cjk[i] + cjk[i + 1])
    }
    cjk = []
  }
  for (const ch of text) {
    if (CJK_RE.test(ch)) {
      flushLatin()
      cjk.push(ch)
    } else if (LATIN_RE.test(ch)) {
      flushCjk()
      latin += ch
    } else {
      flushLatin()
      flushCjk()
    }
  }
  flushLatin()
  flushCjk()
  return tokens
}

export function toFtsIndexText(text: string): string {
  return toBigramTokens(text).join(' ')
}

// 由查询词列表构建 FTS5 MATCH 表达式：每个词内部为短语（保持字序），词之间 OR
export function buildFtsQuery(terms: string[]): string | null {
  const phrases: string[] = []
  for (const term of terms) {
    const tokens = toBigramTokens(term)
    if (tokens.length > 0) phrases.push(`"${tokens.join(' ')}"`)
  }
  return phrases.length > 0 ? phrases.join(' OR ') : null
}

// ============ 飞行器设计中英文术语对照（查询扩展用） ============
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

const REVERSE_TERMS: Record<string, string[]> = {}
for (const [zh, enList] of Object.entries(AERO_TERMS)) {
  for (const en of enList) {
    const key = en.toLowerCase()
    if (!REVERSE_TERMS[key]) REVERSE_TERMS[key] = []
    if (!REVERSE_TERMS[key].includes(zh)) REVERSE_TERMS[key].push(zh)
  }
}

// 查询扩展：中英文术语互扩 + 术语表部分匹配（不含权重，FTS bm25 自行打分）
export function expandQueryTerms(terms: string[]): string[] {
  const termSet = new Set<string>()
  for (const term of terms) {
    termSet.add(term)
    const lower = term.toLowerCase()
    if (AERO_TERMS[term]) {
      for (const en of AERO_TERMS[term]) termSet.add(en.toLowerCase())
    }
    if (REVERSE_TERMS[lower]) {
      for (const zh of REVERSE_TERMS[lower]) termSet.add(zh)
    }
    for (const [zh, enList] of Object.entries(AERO_TERMS)) {
      if (zh.includes(term) && zh !== term) termSet.add(zh)
      for (const en of enList) {
        const enLower = en.toLowerCase()
        if (enLower.includes(lower) && enLower !== lower) termSet.add(enLower)
      }
    }
  }
  return Array.from(termSet)
}

// ============ 类型 ============
export interface KbDocumentRow {
  id: string
  file_path: string
  file_name: string
  file_type: string
  domain_category: string
  tags: string
  file_hash: string | null
  index_status: string
  chunk_count: number
  file_size: number
  added_at: string
  indexed_at: string | null
}

export interface KbSearchResult {
  content: string
  document_id: string
  file_name: string
  score: number
}

// ============ 连接管理（随工作区切换） ============
let kbDb: Database.Database | null = null
let kbDbPath: string | null = null

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS kb_documents (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      domain_category TEXT DEFAULT '未分类',
      tags TEXT DEFAULT '[]',
      file_hash TEXT,
      index_status TEXT DEFAULT 'pending',
      chunk_count INTEGER DEFAULT 0,
      file_size INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      indexed_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_kb_documents_hash ON kb_documents(file_hash) WHERE file_hash IS NOT NULL;
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER DEFAULT 0,
      chapter_title TEXT,
      embedding BLOB,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES kb_documents(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON kb_chunks(document_id);
    CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(content, tokenize='unicode61');
  `)
}

export function initKbDatabase(dbFilePath: string): void {
  const dir = path.dirname(dbFilePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  kbDbPath = dbFilePath
  kbDb = new Database(dbFilePath)
  kbDb.pragma('journal_mode = WAL')
  createSchema(kbDb)
  console.log('[KB] Opened kb database:', dbFilePath)
}

export function switchKbDatabase(newPath: string): void {
  closeKbDatabase()
  initKbDatabase(newPath)
  invalidateTagsCache()
}

export function closeKbDatabase(): void {
  if (kbDb) {
    try { kbDb.close() } catch { /* ignore */ }
    kbDb = null
    kbDbPath = null
  }
}

export function getKbDatabase(): Database.Database {
  if (!kbDb) throw new Error('KB database not initialized')
  return kbDb
}

export function getKbDbPath(): string | null {
  return kbDbPath
}

// ============ 文档 CRUD ============
export function insertDocument(doc: {
  id: string
  filePath: string
  fileName: string
  fileType: string
  fileSize: number
  fileHash?: string | null
  tags?: string[]
}): void {
  getKbDatabase()
    .prepare(
      `INSERT INTO kb_documents (id, file_path, file_name, file_type, file_size, file_hash, tags, index_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'indexing')`
    )
    .run(doc.id, doc.filePath, doc.fileName, doc.fileType, doc.fileSize, doc.fileHash ?? null, JSON.stringify(doc.tags ?? []))
  invalidateTagsCache()
}

export function findDocumentByHash(hash: string): KbDocumentRow | undefined {
  return getKbDatabase().prepare('SELECT * FROM kb_documents WHERE file_hash = ?').get(hash) as KbDocumentRow | undefined
}

export function finalizeDocument(docId: string, domain: string, chunkCount: number): void {
  getKbDatabase()
    .prepare(`UPDATE kb_documents SET domain_category = ?, index_status = 'done', chunk_count = ?, indexed_at = datetime('now') WHERE id = ?`)
    .run(domain, chunkCount, docId)
}

export function markDocumentError(docId: string): void {
  getKbDatabase().prepare(`UPDATE kb_documents SET index_status = 'error' WHERE id = ?`).run(docId)
}

export function updateDocumentTags(docId: string, tags: string[]): void {
  getKbDatabase().prepare('UPDATE kb_documents SET tags = ? WHERE id = ?').run(JSON.stringify(tags), docId)
  invalidateTagsCache()
}

export function updateDocumentDomain(docId: string, domain: string): void {
  getKbDatabase().prepare('UPDATE kb_documents SET domain_category = ? WHERE id = ?').run(domain.trim() || '未分类', docId)
}

// 分块写入：单文档全部 chunk 一个事务，同步维护 FTS 索引（rowid 对齐）
export function insertChunks(docId: string, chunks: string[]): number {
  const db = getKbDatabase()
  const insChunk = db.prepare('INSERT INTO kb_chunks (id, document_id, content, chunk_index) VALUES (?, ?, ?, ?)')
  const insFts = db.prepare('INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)')
  const tx = db.transaction((items: string[]): number => {
    for (let i = 0; i < items.length; i++) {
      const info = insChunk.run(uuidv4(), docId, items[i], i)
      insFts.run(info.lastInsertRowid, toFtsIndexText(items[i]))
    }
    return items.length
  })
  return tx(chunks)
}

export function deleteDocument(docId: string): void {
  deleteDocuments([docId])
}

// 批量删除：单事务清理 FTS 索引、chunks、文档记录
export function deleteDocuments(docIds: string[]): void {
  if (docIds.length === 0) return
  const db = getKbDatabase()
  const delFts = db.prepare('DELETE FROM kb_chunks_fts WHERE rowid IN (SELECT rowid FROM kb_chunks WHERE document_id = ?)')
  const delChunks = db.prepare('DELETE FROM kb_chunks WHERE document_id = ?')
  const delDoc = db.prepare('DELETE FROM kb_documents WHERE id = ?')
  const tx = db.transaction((ids: string[]): void => {
    for (const id of ids) {
      delFts.run(id)
      delChunks.run(id)
      delDoc.run(id)
    }
  })
  tx(docIds)
  invalidateTagsCache()
}

// 标签缓存：listAllTags 需 json_each 全表扫描，知识库大时开销明显。
// 标签只在导入/删除/编辑/切库时变化，缓存 + 失效即可（同一函数内定义避免循环引用问题）
let tagsCache: string[] | null = null

function invalidateTagsCache(): void {
  tagsCache = null
}

// 列表查询用显式列名（列表不需要 embedding 等大字段；未来表加列也不会被 SELECT * 带出）
const DOCUMENT_LIST_COLUMNS = 'id, file_path, file_name, file_type, domain_category, tags, file_hash, index_status, chunk_count, file_size, added_at, indexed_at'

export function listDocuments(category?: string): KbDocumentRow[] {
  const db = getKbDatabase()
  if (category && category !== '全部') {
    return db.prepare(`SELECT ${DOCUMENT_LIST_COLUMNS} FROM kb_documents WHERE domain_category = ? ORDER BY added_at DESC`).all(category) as KbDocumentRow[]
  }
  return db.prepare(`SELECT ${DOCUMENT_LIST_COLUMNS} FROM kb_documents ORDER BY added_at DESC`).all() as KbDocumentRow[]
}

export function getStats(): { totalDocuments: number; totalChunks: number; categories: Array<{ category: string; count: number }> } {
  const db = getKbDatabase()
  const docCount = (db.prepare('SELECT COUNT(*) c FROM kb_documents').get() as { c: number }).c
  const chunkCount = (db.prepare('SELECT COUNT(*) c FROM kb_chunks').get() as { c: number }).c
  const categories = db.prepare('SELECT domain_category category, COUNT(*) count FROM kb_documents GROUP BY domain_category').all() as Array<{ category: string; count: number }>
  return { totalDocuments: docCount, totalChunks: chunkCount, categories }
}

export function listCategories(): string[] {
  const rows = getKbDatabase().prepare('SELECT DISTINCT domain_category c FROM kb_documents').all() as Array<{ c: string }>
  return ['全部', ...rows.map((r) => r.c)]
}

// 汇总所有文档的标签（去重，带缓存）
export function listAllTags(): string[] {
  if (tagsCache) return tagsCache
  const rows = getKbDatabase().prepare(`SELECT DISTINCT je.value t FROM kb_documents, json_each(kb_documents.tags) je ORDER BY t`).all() as Array<{ t: string }>
  tagsCache = rows.map((r) => r.t)
  return tagsCache
}

export function getFileName(documentId: string): string {
  const row = getKbDatabase().prepare('SELECT file_name FROM kb_documents WHERE id = ?').get(documentId) as { file_name: string } | undefined
  return row?.file_name || '未知文件'
}

// ============ FTS5 检索 ============
export function searchFts(
  query: string,
  limit = 10,
  filters?: { domain?: string; tags?: string[] }
): KbSearchResult[] {
  const rawTerms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 0)
  if (rawTerms.length === 0) return []

  const ftsQuery = buildFtsQuery(expandQueryTerms(rawTerms))
  if (!ftsQuery) return []

  const conditions: string[] = ['kb_chunks_fts MATCH ?']
  const params: unknown[] = [ftsQuery]

  if (filters?.domain && filters.domain !== '未分类') {
    conditions.push('d.domain_category = ?')
    params.push(filters.domain)
  }
  if (filters?.tags && filters.tags.length > 0) {
    conditions.push(`EXISTS (SELECT 1 FROM json_each(d.tags) je WHERE je.value IN (SELECT value FROM json_each(?)))`)
    params.push(JSON.stringify(filters.tags))
  }

  const sql = `
    SELECT c.content, c.document_id, d.file_name, -bm25(kb_chunks_fts) AS score
    FROM kb_chunks_fts
    JOIN kb_chunks c ON c.rowid = kb_chunks_fts.rowid
    JOIN kb_documents d ON d.id = c.document_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY score DESC
    LIMIT ?
  `
  params.push(limit)

  try {
    return getKbDatabase().prepare(sql).all(...params) as KbSearchResult[]
  } catch (err) {
    console.warn('[KB] FTS search failed:', err)
    return []
  }
}

// ============ 向量嵌入（预留；当前 embedding 模型不可用，列保持 NULL） ============
export function addChunkEmbedding(chunkId: string, embedding: number[]): void {
  const buffer = Buffer.from(new Float32Array(embedding).buffer)
  getKbDatabase().prepare('UPDATE kb_chunks SET embedding = ? WHERE id = ?').run(buffer, chunkId)
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

export function searchByVector(
  queryEmbedding: number[],
  topK = 10
): Array<{ chunkId: string; documentId: string; content: string; score: number }> {
  const rows = getKbDatabase()
    .prepare('SELECT id, document_id, content, embedding FROM kb_chunks WHERE embedding IS NOT NULL')
    .all() as Array<{ id: string; document_id: string; content: string; embedding: Buffer | null }>

  const scored: Array<{ chunkId: string; documentId: string; content: string; score: number }> = []
  for (const row of rows) {
    if (!row.embedding) continue
    try {
      const float32 = new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4)
      const score = cosineSimilarity(queryEmbedding, Array.from(float32))
      if (score > 0) scored.push({ chunkId: row.id, documentId: row.document_id, content: row.content, score })
    } catch { /* skip corrupted */ }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}

export function getChunksWithoutEmbedding(docId: string): Array<{ id: string; content: string }> {
  return getKbDatabase()
    .prepare('SELECT id, content FROM kb_chunks WHERE document_id = ? AND embedding IS NULL')
    .all(docId) as Array<{ id: string; content: string }>
}

export function listDoneDocuments(): Array<{ id: string; file_name: string }> {
  return getKbDatabase()
    .prepare(`SELECT id, file_name FROM kb_documents WHERE index_status = 'done'`)
    .all() as Array<{ id: string; file_name: string }>
}

// ============ 旧数据迁移（sql.js → kb.db，一次性） ============
export function migrateLegacyKb(sqlDb: SqlJsDatabase): number {
  const db = getKbDatabase()
  const existing = (db.prepare('SELECT COUNT(*) c FROM kb_documents').get() as { c: number }).c
  if (existing > 0) return 0

  let legacyDocs: unknown[][] = []
  try {
    const result = sqlDb.exec('SELECT id, file_path, file_name, file_type, domain_category, index_status, chunk_count, file_size, added_at, indexed_at FROM kb_documents')
    legacyDocs = (result[0]?.values as unknown[][]) || []
  } catch {
    return 0 // 旧库没有 kb 表
  }
  if (legacyDocs.length === 0) return 0

  console.log(`[KB] Migrating ${legacyDocs.length} legacy documents from sql.js...`)
  const insDoc = db.prepare(
    `INSERT INTO kb_documents (id, file_path, file_name, file_type, domain_category, index_status, chunk_count, file_size, added_at, indexed_at, tags)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '[]')`
  )
  const insChunk = db.prepare('INSERT INTO kb_chunks (id, document_id, content, chunk_index, chapter_title, embedding) VALUES (?, ?, ?, ?, ?, ?)')
  const insFts = db.prepare('INSERT INTO kb_chunks_fts (rowid, content) VALUES (?, ?)')

  const tx = db.transaction((): void => {
    for (const row of legacyDocs) {
      insDoc.run(...(row as unknown[]))
      const chunkRows = sqlDb.exec('SELECT id, content, chunk_index, chapter_title, embedding FROM kb_chunks WHERE document_id = ?', [row[0] as string])
      for (const c of (chunkRows[0]?.values as unknown[][]) || []) {
        const info = insChunk.run(c[0], row[0], c[1], c[2], c[3], c[4])
        insFts.run(info.lastInsertRowid, toFtsIndexText(c[1] as string))
      }
    }
  })
  tx()
  console.log('[KB] Legacy migration done')
  return legacyDocs.length
}
