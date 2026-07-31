import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'

// 表格数据库：导入的 xlsx/csv/tsv/txt 转为真实 SQLite 表，供模型精确查表
// 每工作区一个 tables.db，与 kb.db 同目录，随工作区切换

export interface TableColumn {
  name: string
  type: 'INTEGER' | 'REAL' | 'TEXT'
}

export interface DatasetMeta {
  id: string
  name: string
  source_file: string
  file_type: string
  table_count: number
  total_rows: number
  created_at: string
}

export interface DataTableMeta {
  id: string
  dataset_id: string
  table_name: string
  sheet_name: string | null
  columns: TableColumn[]
  row_count: number
}

export interface QueryResult {
  columns: string[]
  rows: Array<Record<string, unknown>>
  truncated: boolean
}

const QUERY_ROW_LIMIT = 200

// 元数据表名，禁止用户表占用
const RESERVED_NAMES = new Set(['_datasets', '_tables'])

// ============ 连接管理（随工作区切换） ============
let tablesDb: Database.Database | null = null
let tablesDbPath: string | null = null

function createSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _datasets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      source_file TEXT NOT NULL,
      file_type TEXT NOT NULL,
      table_count INTEGER DEFAULT 0,
      total_rows INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS _tables (
      id TEXT PRIMARY KEY,
      dataset_id TEXT NOT NULL,
      table_name TEXT NOT NULL,
      sheet_name TEXT,
      columns_json TEXT NOT NULL,
      row_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (dataset_id) REFERENCES _datasets(id) ON DELETE CASCADE
    );
  `)
  db.pragma('foreign_keys = ON')
}

export function initTablesDatabase(dbFilePath: string): void {
  const dir = path.dirname(dbFilePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  tablesDbPath = dbFilePath
  tablesDb = new Database(dbFilePath)
  tablesDb.pragma('journal_mode = WAL')
  createSchema(tablesDb)
  console.log('[Tables] Opened tables database:', dbFilePath)
}

export function switchTablesDatabase(newPath: string): void {
  closeTablesDatabase()
  initTablesDatabase(newPath)
}

export function closeTablesDatabase(): void {
  if (tablesDb) {
    try { tablesDb.close() } catch { /* ignore */ }
    tablesDb = null
    tablesDbPath = null
  }
}

export function getTablesDatabase(): Database.Database {
  if (!tablesDb) throw new Error('Tables database not initialized')
  return tablesDb
}

// ============ 标识符处理 ============
export function quoteIdent(ident: string): string {
  return '"' + ident.replace(/"/g, '""') + '"'
}

// 清洗表名：去引号、空白转下划线；避免与元数据表/已有表冲突
export function sanitizeTableName(raw: string): string {
  let name = raw.trim().replace(/"/g, '').replace(/\s+/g, '_')
  if (!name) name = 'table'
  if (name.startsWith('_')) name = 't' + name
  if (/^\d/.test(name)) name = 't_' + name
  if (RESERVED_NAMES.has(name.toLowerCase())) name = `${name}_data`
  const db = getTablesDatabase()
  let finalName = name
  let i = 2
  const exists = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
  while (exists.get(finalName)) {
    finalName = `${name}_${i++}`
  }
  return finalName
}

// 清洗列名：空名补 col_N，重名加 _2 后缀
export function sanitizeColumnNames(rawHeaders: unknown[]): string[] {
  const seen = new Map<string, number>()
  return rawHeaders.map((h, idx) => {
    let name = String(h ?? '').trim().replace(/"/g, '')
    if (!name) name = `col_${idx + 1}`
    const count = seen.get(name) || 0
    seen.set(name, count + 1)
    return count === 0 ? name : `${name}_${count + 1}`
  })
}

// ============ 类型推断与建表 ============
const INT_RE = /^-?\d+$/
const NUM_RE = /^-?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

export function inferColumns(headers: string[], dataRows: unknown[][]): TableColumn[] {
  const sample = dataRows.slice(0, 100)
  return headers.map((name, colIdx) => {
    let allInt = true
    let allNum = true
    let seenValue = false
    for (const row of sample) {
      const v = String(row[colIdx] ?? '').trim()
      if (!v) continue
      seenValue = true
      if (!NUM_RE.test(v)) {
        allInt = false
        allNum = false
        break
      }
      if (!INT_RE.test(v)) allInt = false
    }
    const type = !seenValue ? 'TEXT' : allInt ? 'INTEGER' : allNum ? 'REAL' : 'TEXT'
    return { name, type }
  })
}

function toTypedValue(raw: unknown, type: TableColumn['type']): unknown {
  const v = String(raw ?? '').trim()
  if (!v) return null
  if (type === 'INTEGER') return INT_RE.test(v) ? parseInt(v, 10) : null
  if (type === 'REAL') return NUM_RE.test(v) ? parseFloat(v) : null
  return String(raw ?? '')
}

// ============ 数据集 CRUD ============
export function findDatasetByName(name: string): DatasetMeta | undefined {
  return getTablesDatabase().prepare('SELECT * FROM _datasets WHERE name = ?').get(name) as DatasetMeta | undefined
}

export function insertDataset(meta: { id: string; name: string; sourceFile: string; fileType: string }): void {
  getTablesDatabase()
    .prepare('INSERT INTO _datasets (id, name, source_file, file_type) VALUES (?, ?, ?, ?)')
    .run(meta.id, meta.name, meta.sourceFile, meta.fileType)
}

export function listDatasets(): DatasetMeta[] {
  return getTablesDatabase().prepare('SELECT * FROM _datasets ORDER BY created_at DESC').all() as DatasetMeta[]
}

export function listTables(datasetId: string): DataTableMeta[] {
  const rows = getTablesDatabase()
    .prepare('SELECT * FROM _tables WHERE dataset_id = ? ORDER BY created_at ASC')
    .all(datasetId) as Array<Omit<DataTableMeta, 'columns'> & { columns_json: string }>
  return rows.map((r) => ({ ...r, columns: JSON.parse(r.columns_json || '[]') as TableColumn[] }))
}

export function listAllTables(): DataTableMeta[] {
  const rows = getTablesDatabase().prepare('SELECT * FROM _tables ORDER BY created_at ASC').all() as Array<
    Omit<DataTableMeta, 'columns'> & { columns_json: string }
  >
  return rows.map((r) => ({ ...r, columns: JSON.parse(r.columns_json || '[]') as TableColumn[] }))
}

// 删除数据集：连带 DROP 其所有真实表（foreign_keys ON 时元数据级联删除）
export function deleteDataset(datasetId: string): void {
  const db = getTablesDatabase()
  const tables = db.prepare('SELECT table_name FROM _tables WHERE dataset_id = ?').all(datasetId) as Array<{ table_name: string }>
  const tx = db.transaction(() => {
    for (const t of tables) {
      db.prepare(`DROP TABLE IF EXISTS ${quoteIdent(t.table_name)}`).run()
    }
    db.prepare('DELETE FROM _datasets WHERE id = ?').run(datasetId)
  })
  tx()
}

// 建真实表并写入数据 + 元数据（单事务）
export function createDataTable(input: {
  id: string
  datasetId: string
  tableName: string
  sheetName: string | null
  columns: TableColumn[]
  rows: unknown[][]
}): number {
  const db = getTablesDatabase()
  const colDefs = input.columns.map((c) => `${quoteIdent(c.name)} ${c.type}`).join(', ')
  const placeholders = input.columns.map(() => '?').join(', ')
  const tx = db.transaction(() => {
    db.prepare(`CREATE TABLE ${quoteIdent(input.tableName)} (${colDefs})`).run()
    const ins = db.prepare(`INSERT INTO ${quoteIdent(input.tableName)} VALUES (${placeholders})`)
    for (const row of input.rows) {
      ins.run(input.columns.map((c, i) => toTypedValue(row[i], c.type)))
    }
    db.prepare('INSERT INTO _tables (id, dataset_id, table_name, sheet_name, columns_json, row_count) VALUES (?, ?, ?, ?, ?, ?)').run(
      input.id,
      input.datasetId,
      input.tableName,
      input.sheetName,
      JSON.stringify(input.columns),
      input.rows.length
    )
    db.prepare('UPDATE _datasets SET table_count = table_count + 1, total_rows = total_rows + ? WHERE id = ?').run(
      input.rows.length,
      input.datasetId
    )
  })
  tx()
  return input.rows.length
}

// ============ 查询 ============
export function previewRows(tableName: string, limit = 20): QueryResult {
  return runReadOnlyQuery(`SELECT * FROM ${quoteIdent(tableName)} LIMIT ${Math.max(1, Math.min(limit, QUERY_ROW_LIMIT))}`)
}

// 只读查询：stmt.reader 判定，非 SELECT 直接拒绝；无 LIMIT 自动补上限
export function runReadOnlyQuery(sql: string): QueryResult {
  const db = getTablesDatabase()
  const cleaned = sql.trim().replace(/;+\s*$/, '')
  if (!cleaned) throw new Error('SQL 为空')
  if (cleaned.includes(';')) throw new Error('仅支持单条 SELECT 语句')

  let stmt: Database.Statement
  try {
    stmt = db.prepare(cleaned)
  } catch (err: any) {
    throw new Error(`SQL 语法错误: ${err.message || String(err)}`)
  }
  if (!stmt.reader) {
    throw new Error('仅允许只读查询（SELECT），写入/DDL 操作已被拒绝')
  }

  let finalSql = cleaned
  let truncated = false
  if (!/\blimit\s+\d+/i.test(cleaned)) {
    finalSql = `${cleaned} LIMIT ${QUERY_ROW_LIMIT + 1}`
    truncated = true
  }
  const finalStmt = db.prepare(finalSql)
  const columns = finalStmt.columns().map((c) => c.name)
  let rows = finalStmt.all() as Array<Record<string, unknown>>
  if (rows.length > QUERY_ROW_LIMIT) {
    rows = rows.slice(0, QUERY_ROW_LIMIT)
  } else {
    truncated = false
  }
  return { columns, rows, truncated }
}
