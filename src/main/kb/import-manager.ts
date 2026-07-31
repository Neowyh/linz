import { utilityProcess } from 'electron'
import type { UtilityProcess, WebContents } from 'electron'
import path from 'path'
import fs from 'fs'
import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import * as kb from '../database/kb'
import { parseFile } from '../parsers'

// 批量导入支持的扩展名（与 kb:uploadDocuments 的过滤器一致）
const SUPPORTED_EXTS = new Set(['.pdf', '.docx', '.doc', '.xlsx', '.csv', '.txt', '.md', '.dat', '.json', '.png', '.jpg', '.jpeg'])
// 图片走主进程 OCR（tesseract 依赖 worker_threads，不放进 parse worker）
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg'])

const PARSE_TIMEOUT_MS = 300_000 // 单文件解析超时 5 分钟
const WORKER_COUNT = 2 // Win7 内存保守，并发 2

// ============ 文本分块（从 knowledge.ipc 迁入，知识库导入专用） ============
export function chunkText(text: string, chunkSize = 500, overlap = 100): string[] {
  if (!text || text.trim().length === 0) return []
  const step = chunkSize - overlap
  if (step <= 0) return [text.substring(0, chunkSize)]
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

// ============ 类型 ============
export interface ImportProgressEvent {
  total: number
  done: number // 已完成（含 skipped/error）
  current?: string // 正在处理的文件名
  fileName: string
  status: 'parsing' | 'indexing' | 'done' | 'skipped' | 'error'
  error?: string
  chunkCount?: number
}

export interface ImportFileResult {
  fileName: string
  status: 'done' | 'skipped' | 'error'
  error?: string
  chunkCount?: number
  docId?: string
}

export interface ImportSummary {
  total: number
  done: number
  skipped: number
  error: number
  results: ImportFileResult[]
}

// ============ 解析 Worker 池 ============
interface PendingParse {
  resolve: (value: { content: string; metadata?: Record<string, unknown>; error?: string }) => void
  timer: NodeJS.Timeout
}

class ParseWorker {
  private proc: UtilityProcess | null = null
  private pending = new Map<number, PendingParse>()
  private nextId = 1
  private currentFile: string | null = null

  constructor(private index: number) {
    this.spawn()
  }

  private spawn(): void {
    const workerPath = path.join(__dirname, 'parse-worker.js')
    this.proc = utilityProcess.fork(workerPath, [], { serviceName: `kb-parse-worker-${this.index}` })
    this.proc.on('message', (msg: { id: number; content: string; metadata?: Record<string, unknown>; error?: string }) => {
      const p = this.pending.get(msg.id)
      if (!p) return
      this.pending.delete(msg.id)
      clearTimeout(p.timer)
      this.currentFile = null
      p.resolve({ content: msg.content, metadata: msg.metadata, error: msg.error })
    })
    this.proc.on('exit', (code) => {
      console.warn(`[KB Import] parse worker ${this.index} exited with code ${code}`)
      // 进程异常退出：把挂起的请求全部置为失败
      for (const [, p] of this.pending) {
        clearTimeout(p.timer)
        p.resolve({ content: '', error: `解析进程异常退出 (code ${code})` })
      }
      this.pending.clear()
      this.currentFile = null
      this.proc = null
    })
  }

  parse(filePath: string): Promise<{ content: string; metadata?: Record<string, unknown>; error?: string }> {
    // 上次任务超时/崩溃后 worker 已死，先重建
    if (!this.proc) this.spawn()
    const proc = this.proc!
    return new Promise((resolve) => {
      const id = this.nextId++
      const timer = setTimeout(() => {
        this.pending.delete(id)
        this.currentFile = null
        resolve({ content: '', error: '解析超时（超过5分钟）' })
        // 超时后 worker 可能卡死，杀掉由下次任务重建
        try { proc.kill() } catch { /* ignore */ }
      }, PARSE_TIMEOUT_MS)
      this.pending.set(id, { resolve, timer })
      this.currentFile = filePath
      proc.postMessage({ id, filePath })
    })
  }

  dispose(): void {
    for (const [, p] of this.pending) {
      clearTimeout(p.timer)
      p.resolve({ content: '', error: '导入已取消' })
    }
    this.pending.clear()
    if (this.proc) {
      try { this.proc.kill() } catch { /* ignore */ }
      this.proc = null
    }
  }
}

// ============ 工具函数 ============
function walkFiles(inputPaths: string[]): string[] {
  const files: string[] = []
  const walk = (p: string): void => {
    let stat: fs.Stats
    try {
      stat = fs.statSync(p)
    } catch {
      return
    }
    if (stat.isDirectory()) {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(p, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        walk(path.join(p, entry.name))
      }
    } else if (stat.isFile() && SUPPORTED_EXTS.has(path.extname(p).toLowerCase())) {
      files.push(p)
    }
  }
  for (const p of inputPaths) walk(p)
  return files
}

function hashFile(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    const stream = fs.createReadStream(filePath)
    stream.on('data', (d) => hash.update(d))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

// 文本提取：图片走主进程 OCR，其余交给 parse worker
async function extractViaWorker(worker: ParseWorker, filePath: string): Promise<{ content: string; error?: string }> {
  const r = await worker.parse(filePath)
  return { content: r.content || '', error: r.error }
}

async function extractInMain(filePath: string): Promise<{ content: string; error?: string }> {
  const r = await parseFile(filePath, { fullText: true })
  return { content: r.content || '', error: r.error }
}

// ============ 导入入口 ============
let activeImport: Promise<ImportSummary> | null = null

export function isImportRunning(): boolean {
  return activeImport !== null
}

export async function startImport(
  inputPaths: string[],
  tags: string[],
  domain: string,
  sender: WebContents
): Promise<ImportSummary> {
  if (activeImport) {
    return { total: 0, done: 0, skipped: 0, error: 0, results: [{ fileName: '-', status: 'error', error: '已有导入任务正在进行中' }] }
  }
  activeImport = runImport(inputPaths, tags, domain, sender)
  try {
    return await activeImport
  } finally {
    activeImport = null
  }
}

async function runImport(inputPaths: string[], tags: string[], domain: string, sender: WebContents): Promise<ImportSummary> {
  const docDomain = domain.trim() || '未分类'
  const files = walkFiles(inputPaths)
  const results: ImportFileResult[] = []
  const summary: ImportSummary = { total: files.length, done: 0, skipped: 0, error: 0, results }

  const sendProgress = (event: Omit<ImportProgressEvent, 'total' | 'done'>): void => {
    if (sender.isDestroyed()) return
    sender.send('kb:importProgress', { ...event, total: summary.total, done: summary.done + summary.skipped + summary.error } as ImportProgressEvent)
  }

  if (files.length === 0) return summary

  const workers: ParseWorker[] = []
  for (let i = 0; i < WORKER_COUNT; i++) workers.push(new ParseWorker(i))

  try {
    // 预计算 hash 去重（流式，逐文件）
    const seenHashes = new Set<string>()
    const toImport: Array<{ filePath: string; hash: string }> = []
    for (const filePath of files) {
      const fileName = path.basename(filePath)
      let hash = ''
      try {
        hash = await hashFile(filePath)
      } catch (err) {
        summary.error++
        results.push({ fileName, status: 'error', error: `读取文件失败: ${err instanceof Error ? err.message : String(err)}` })
        sendProgress({ fileName, status: 'error', error: '读取文件失败' })
        continue
      }
      if (seenHashes.has(hash) || kb.findDocumentByHash(hash)) {
        summary.skipped++
        results.push({ fileName, status: 'skipped', error: '内容重复，已跳过' })
        sendProgress({ fileName, status: 'skipped', error: '内容重复' })
        continue
      }
      seenHashes.add(hash)
      toImport.push({ filePath, hash })
    }

    // 并发解析 + 串行写库
    let cursor = 0
    const workerLoop = async (worker: ParseWorker): Promise<void> => {
      while (cursor < toImport.length) {
        const task = toImport[cursor++]
        const fileName = path.basename(task.filePath)
        const ext = path.extname(task.filePath).toLowerCase()

        sendProgress({ fileName, status: 'parsing' })
        const { content, error } = IMAGE_EXTS.has(ext)
          ? await extractInMain(task.filePath)
          : await extractViaWorker(worker, task.filePath)

        if (error || !content || content.trim().length === 0) {
          summary.error++
          results.push({ fileName, status: 'error', error: error || '未提取到文本内容' })
          sendProgress({ fileName, status: 'error', error: error || '内容为空' })
          continue
        }

        sendProgress({ fileName, status: 'indexing' })
        const docId = uuidv4()
        try {
          const stats = fs.statSync(task.filePath)
          kb.insertDocument({
            id: docId,
            filePath: task.filePath,
            fileName,
            fileType: ext.replace('.', ''),
            fileSize: stats.size,
            fileHash: task.hash,
            tags
          })
          const chunks = chunkText(content)
          kb.insertChunks(docId, chunks)
          kb.finalizeDocument(docId, docDomain, chunks.length)
          summary.done++
          results.push({ fileName, status: 'done', chunkCount: chunks.length, docId })
          sendProgress({ fileName, status: 'done', chunkCount: chunks.length })
        } catch (err) {
          kb.markDocumentError(docId)
          summary.error++
          const msg = err instanceof Error ? err.message : String(err)
          results.push({ fileName, status: 'error', error: `写入索引失败: ${msg}` })
          sendProgress({ fileName, status: 'error', error: msg })
        }
      }
    }

    await Promise.all(workers.map((w) => workerLoop(w)))
  } finally {
    for (const w of workers) w.dispose()
  }

  return summary
}
