import { ipcMain, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { pathToFileURL } from 'url'
import mammoth from 'mammoth'
import XLSX from 'xlsx'
import { getFileWorkspacePath } from '../store/app-config'
import { resolveWithinRoot } from '../fs/path-guard'
import { parseFile } from '../parsers'

export interface FileEntry {
  name: string
  /** 相对工作空间根目录的路径，统一用 '/' 分隔；根目录为 '' */
  relPath: string
  type: 'dir' | 'file'
  size: number
  mtime: number
}

export type FilePreviewData =
  | { kind: 'text'; content: string; language?: string; truncated?: boolean }
  | { kind: 'html'; html: string; truncated?: boolean }
  | { kind: 'pdf'; url: string; text: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'binary'; message: string }
  | { error: string }

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024
const MAX_CONVERT_BYTES = 20 * 1024 * 1024
const MAX_TEXT_CHARS = 100000

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml'
}

// 复用附件解析器提取文本的结构化文档类型（表格类，预览为纯文本）
const STRUCTURED_EXTS = new Set(['.csv', '.dat'])

const MAX_XLSX_SHEETS = 20

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

// Word 文档 → 格式化 HTML（mammoth 默认把图片以 base64 data URI 内嵌）
async function convertDocxToHtml(abs: string): Promise<string> {
  const result = await mammoth.convertToHtml({ path: abs })
  return result.value || ''
}

// Excel 工作簿 → 每个工作表一个 HTML 表格
function convertXlsxToHtml(abs: string): string {
  const buf = fs.readFileSync(abs)
  const wb = XLSX.read(buf, { type: 'buffer' })
  const names = wb.SheetNames.slice(0, MAX_XLSX_SHEETS)
  const parts: string[] = []
  for (const name of names) {
    const sheet = wb.Sheets[name]
    const table = XLSX.utils.sheet_to_html(sheet, { header: '', footer: '' })
    parts.push(`<div class="linz-xlsx-sheet"><div class="linz-xlsx-title">${escapeHtml(name)}</div>${table}</div>`)
  }
  return parts.join('\n')
}

// 预览代码高亮的语言映射（rehype-highlight 识别）
const LANG_BY_EXT: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.js': 'javascript',
  '.jsx': 'jsx',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.json': 'json',
  '.py': 'python',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.less': 'less',
  '.java': 'java',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
  '.sh': 'bash',
  '.bash': 'bash',
  '.bat': 'bat',
  '.cmd': 'bat',
  '.ps1': 'powershell',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.toml': 'ini',
  '.ini': 'ini',
  '.xml': 'xml',
  '.sql': 'sql',
  '.vue': 'vue',
  '.tex': 'latex',
  '.m': 'objectivec',
  '.cs': 'csharp',
  '.php': 'php',
  '.rb': 'ruby',
  '.swift': 'swift',
  '.kotlin': 'kotlin',
  '.dart': 'dart',
  '.r': 'r',
  '.lua': 'lua',
  '.dockerfile': 'dockerfile',
  '.gitignore': 'gitignore'
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function toRelPath(root: string, abs: string): string {
  const rel = path.relative(root, abs)
  if (!rel) return ''
  return rel.split(path.sep).join('/')
}

function truncate(content: string): { content: string; truncated: boolean } {
  if (content.length > MAX_TEXT_CHARS) {
    return { content: content.slice(0, MAX_TEXT_CHARS) + '\n\n...(内容过长，已截断)', truncated: true }
  }
  return { content, truncated: false }
}

function sortEntries(a: FileEntry, b: FileEntry): number {
  if (a.type !== b.type) return a.type === 'dir' ? -1 : 1
  return a.name.toLowerCase().localeCompare(b.name.toLowerCase())
}

export function registerFileBrowserIPC(): void {
  ipcMain.handle('fileBrowser:getRoot', (): { root: string | null } => {
    return { root: getFileWorkspacePath() || null }
  })

  ipcMain.handle(
    'fileBrowser:list',
    (_event, relPath: string | null | undefined): { entries: FileEntry[] } | { error: string } => {
      const root = getFileWorkspacePath()
      if (!root) return { error: '未设置工作空间目录，请先选择文件夹' }
      const target = relPath || '.'
      const checked = resolveWithinRoot(target, root)
      if (!checked.ok) return { error: checked.error! }
      const resolved = checked.resolved!
      let stat: fs.Stats
      try {
        stat = fs.statSync(resolved)
      } catch {
        return { error: '目录不存在' }
      }
      if (!stat.isDirectory()) return { error: '目标不是目录' }
      let dirents: fs.Dirent[]
      try {
        dirents = fs.readdirSync(resolved, { withFileTypes: true })
      } catch (err: any) {
        return { error: `读取目录失败: ${err.message || String(err)}` }
      }
      const entries: FileEntry[] = dirents.map((d) => {
        const abs = path.join(resolved, d.name)
        const entry: FileEntry = {
          name: d.name,
          relPath: toRelPath(root, abs),
          type: d.isDirectory() ? 'dir' : 'file',
          size: 0,
          mtime: 0
        }
        if (d.isFile()) {
          try {
            const s = fs.statSync(abs)
            entry.size = s.size
            entry.mtime = s.mtimeMs
          } catch {
            // 忽略单个文件 stat 失败
          }
        }
        return entry
      })
      entries.sort(sortEntries)
      return { entries }
    }
  )

  ipcMain.handle('fileBrowser:read', async (_event, relPath: string): Promise<FilePreviewData> => {
    const root = getFileWorkspacePath()
    if (!root) return { error: '未设置工作空间目录，请先选择文件夹' }
    const checked = resolveWithinRoot(relPath || '', root)
    if (!checked.ok) return { error: checked.error! }
    const abs = checked.resolved!
    let stat: fs.Stats
    try {
      stat = fs.statSync(abs)
    } catch {
      return { error: '文件不存在' }
    }
    if (!stat.isFile()) return { error: '目标不是文件' }

    const ext = path.extname(abs).toLowerCase()
    const imageMime = IMAGE_MIME[ext]
    if (imageMime) {
      if (stat.size > MAX_IMAGE_BYTES) {
        return { kind: 'binary', message: `图片过大（${formatBytes(stat.size)}），无法预览` }
      }
      try {
        const b64 = fs.readFileSync(abs).toString('base64')
        return { kind: 'image', dataUrl: `data:${imageMime};base64,${b64}` }
      } catch (err: any) {
        return { kind: 'binary', message: `读取图片失败: ${err.message || String(err)}` }
      }
    }

    if (STRUCTURED_EXTS.has(ext)) {
      if (stat.size > MAX_PREVIEW_BYTES) {
        return { kind: 'binary', message: `文件过大（${formatBytes(stat.size)}），无法预览` }
      }
      const parsed = await parseFile(abs, { fullText: true })
      if (parsed.error) return { kind: 'binary', message: parsed.error }
      const t = truncate(parsed.content)
      return { kind: 'text', content: t.content, language: LANG_BY_EXT[ext], truncated: t.truncated }
    }

    // PDF：返回 file:// URL 供内置 PDF 查看器渲染，同时附带提取的文本作为兜底
    if (ext === '.pdf') {
      if (stat.size > MAX_CONVERT_BYTES) {
        return { kind: 'binary', message: `文件过大（${formatBytes(stat.size)}），无法预览` }
      }
      const parsed = await parseFile(abs, { fullText: true })
      const text = parsed.error ? '' : parsed.content
      return { kind: 'pdf', url: pathToFileURL(abs).href, text }
    }

    // Word：mammoth 转 HTML 富文本预览
    if (ext === '.docx') {
      if (stat.size > MAX_CONVERT_BYTES) {
        return { kind: 'binary', message: `文件过大（${formatBytes(stat.size)}），无法预览` }
      }
      try {
        const html = await convertDocxToHtml(abs)
        if (!html.trim()) return { kind: 'text', content: '(文档内容为空)' }
        return { kind: 'html', html, truncated: false }
      } catch (err: any) {
        return { kind: 'binary', message: `文档解析失败: ${err.message || String(err)}` }
      }
    }

    // Excel：转 HTML 表格预览
    if (ext === '.xlsx' || ext === '.xls') {
      if (stat.size > MAX_CONVERT_BYTES) {
        return { kind: 'binary', message: `文件过大（${formatBytes(stat.size)}），无法预览` }
      }
      try {
        const html = convertXlsxToHtml(abs)
        if (!html.trim()) return { kind: 'text', content: '(表格内容为空)' }
        return { kind: 'html', html, truncated: false }
      } catch (err: any) {
        return { kind: 'binary', message: `表格解析失败: ${err.message || String(err)}` }
      }
    }

    // 文本或未知扩展名：尝试按 UTF-8 读取
    if (stat.size > MAX_PREVIEW_BYTES) {
      return { kind: 'binary', message: `文件过大（${formatBytes(stat.size)}），无法预览` }
    }
    let content: string
    try {
      content = fs.readFileSync(abs, 'utf-8')
    } catch (err: any) {
      return { error: `读取文件失败: ${err.message || String(err)}` }
    }
    if (content.includes('�')) {
      return { kind: 'binary', message: '二进制文件，无法直接预览，可在系统中打开查看' }
    }
    const t = truncate(content)
    return { kind: 'text', content: t.content, language: LANG_BY_EXT[ext], truncated: t.truncated }
  })

  // 读取文件原始字节（base64）：供三维模型/仿真结果等面板加载二进制或完整文本内容
  ipcMain.handle(
    'fileBrowser:readBinary',
    async (
      _event,
      relPath: string
    ): Promise<{ data: string; size: number; error?: never } | { error: string }> => {
      const root = getFileWorkspacePath()
      if (!root) return { error: '未设置工作空间目录，请先选择文件夹' }
      const checked = resolveWithinRoot(relPath || '', root)
      if (!checked.ok) return { error: checked.error! }
      const abs = checked.resolved!
      let stat: fs.Stats
      try {
        stat = fs.statSync(abs)
      } catch {
        return { error: '文件不存在' }
      }
      if (!stat.isFile()) return { error: '目标不是文件' }
      if (stat.size > 64 * 1024 * 1024) return { error: '文件过大（>64MB）' }
      try {
        const buf = fs.readFileSync(abs)
        return { data: buf.toString('base64'), size: buf.length }
      } catch (err: any) {
        return { error: `读取失败: ${err.message || String(err)}` }
      }
    }
  )

  // 在系统默认应用中打开文件（无法预览的格式或用户想用外部工具查看）
  ipcMain.handle(
    'fileBrowser:openExternal',
    async (_event, relPath: string): Promise<{ success: boolean; error?: string }> => {
      const root = getFileWorkspacePath()
      if (!root) return { success: false, error: '未设置工作空间目录' }
      const checked = resolveWithinRoot(relPath || '', root)
      if (!checked.ok) return { success: false, error: checked.error! }
      const abs = checked.resolved!
      if (!fs.existsSync(abs)) return { success: false, error: '文件不存在' }
      const err = await shell.openPath(abs)
      return err ? { success: false, error: err } : { success: true }
    }
  )

  // 在系统文件管理器中定位文件（或打开目录）
  ipcMain.handle(
    'fileBrowser:reveal',
    (_event, relPath: string): { success: boolean; error?: string } => {
      const root = getFileWorkspacePath()
      if (!root) return { success: false, error: '未设置工作空间目录' }
      const checked = resolveWithinRoot(relPath || '', root)
      if (!checked.ok) return { success: false, error: checked.error! }
      const abs = checked.resolved!
      if (!fs.existsSync(abs)) return { success: false, error: '路径不存在' }
      try {
        shell.showItemInFolder(abs)
        return { success: true }
      } catch (err: any) {
        return { success: false, error: err.message || String(err) }
      }
    }
  )
}
