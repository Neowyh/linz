import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import type { AgentContext } from '../base.agent'
import { resolveWithinRoot } from '../../fs/path-guard'
import { checkPathAllowed } from '../../security/file-protection'

// 代码审查场景专用只读文件工具：目录树 / 带行号读取 / 代码搜索。
// 与 filesystem.tool.ts 并列，仅在设置工作空间时由 getToolsForAgent 动态注入。
// 全部只读（risk=read），路径安全经 resolveWithinRoot + checkPathAllowed 双重校验。

const MAX_CODE_READ_CHARS = 50000
const MAX_TREE_ENTRIES = 500
const MAX_SEARCH_RESULTS = 200
const MAX_SEARCH_FILES = 200

// 目录树与搜索时应跳过的非源码目录（依赖、构建产物、缓存、IDE 配置）
const IGNORED_DIRS = new Set([
  'node_modules', '.git', '.svn', '.hg', 'dist', 'build', '.next', 'out', '.nuxt',
  '.venv', 'venv', 'env', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache',
  '.idea', '.vscode', '.vs', 'coverage', '.nyc_output', '.cache', '.turbo',
  'target', 'bin', 'obj', '.gradle', '.angular', '.svelte-kit', '.parcel-cache'
])

export interface CodeFsToolDeps {
  context: AgentContext
}

// BFS 收集 rootDir 下的文件相对路径（用 / 分隔，不含 rootDir 自身前缀）。
// 跳过 IGNORED_DIRS，受 maxDepth 与 maxFiles 上限保护，不读取文件内容。
function walkCodeFiles(rootDir: string, maxDepth: number, maxFiles: number): string[] {
  const collected: string[] = []
  const stack: Array<{ dir: string; rel: string; depth: number }> = [{ dir: rootDir, rel: '', depth: 0 }]
  let head = 0
  while (head < stack.length && collected.length < maxFiles) {
    const { dir, rel, depth } = stack[head++]
    if (depth > maxDepth) continue
    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (collected.length >= maxFiles) break
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (IGNORED_DIRS.has(e.name)) continue
        stack.push({ dir: path.join(dir, e.name), rel: childRel, depth: depth + 1 })
      } else if (e.isFile()) {
        collected.push(childRel)
      }
    }
  }
  return collected
}

export function createCodeFsTools(deps: CodeFsToolDeps): Tool[] {
  const { context } = deps
  const root = context.fileWorkspacePath

  // 工作空间未设置时返回提示而非报错——LLM 会知道需要让用户先设置
  const ensureRoot = (): { ok: boolean; root?: string; error?: string } => {
    if (!root) {
      return { ok: false, error: '未设置工作空间目录，无法读取代码文件。请让用户在对话框下方点击"工作空间"按钮选择代码所在的文件夹。' }
    }
    return { ok: true, root }
  }

  // 绝对路径 → 相对工作空间根的展示路径（统一用 / 分隔）
  const toRel = (absPath: string): string => {
    if (!root) return absPath
    const rel = path.relative(root, absPath)
    return rel ? rel.replace(/\\/g, '/') : '.'
  }

  const codeTree = new DynamicStructuredTool({
    name: 'code_tree',
    description: '递归列出代码项目的目录结构树，用于先了解项目整体结构。参数 path 为相对工作空间根的目录（省略或 null 从根开始），maxDepth 限制递归深度（默认 4，最大 8），includeFiles 控制是否在树中显示文件（默认 true）。自动跳过 node_modules/.git/dist/build 等非源码目录。返回缩进树形结构，文件标注大小。',
    schema: z.object({
      path: z.string().nullable().describe('要列出目录树的相对路径，省略或 null 时从工作空间根开始'),
      maxDepth: z.number().nullable().describe('递归深度上限，默认 4，最大 8'),
      includeFiles: z.boolean().nullable().describe('是否在树中包含文件，默认 true')
    }),
    func: async ({ path: relPath, maxDepth, includeFiles }): Promise<string> => {
      const r = ensureRoot()
      if (!r.ok) return r.error!
      const target = relPath || '.'
      const checked = resolveWithinRoot(target, r.root!)
      if (!checked.ok) return checked.error!
      const resolved = checked.resolved!
      const protect = checkPathAllowed(resolved)
      if (!protect.ok) return `⛔ 文件防护拦截：该路径命中受保护目录（${protect.protectedPath}）`
      const depthLimit = maxDepth == null ? 4 : Math.min(Math.max(1, Math.floor(maxDepth)), 8)
      const withFiles = includeFiles == null ? true : includeFiles

      if (!fs.existsSync(resolved)) return `目录不存在: ${target}`
      const stat = fs.statSync(resolved)
      if (!stat.isDirectory()) return `目标不是目录: ${target}`

      const lines: string[] = []
      let entryCount = 0

      const walk = (dir: string, prefix: string, depth: number): void => {
        if (depth > depthLimit || entryCount >= MAX_TREE_ENTRIES) return
        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          return
        }
        entries.sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1
          return a.name.localeCompare(b.name)
        })
        for (const e of entries) {
          if (entryCount >= MAX_TREE_ENTRIES) break
          const full = path.join(dir, e.name)
          if (e.isDirectory()) {
            if (IGNORED_DIRS.has(e.name)) continue
            if (!checkPathAllowed(full).ok) continue
            lines.push(`${prefix}${e.name}/`)
            entryCount++
            walk(full, `${prefix}  `, depth + 1)
          } else if (e.isFile() && withFiles) {
            if (!checkPathAllowed(full).ok) continue
            let sizeStr = ''
            try {
              const sz = fs.statSync(full).size
              sizeStr = sz >= 1024 ? ` (${(sz / 1024).toFixed(1)}KB)` : ` (${sz}B)`
            } catch { /* ignore */ }
            lines.push(`${prefix}${e.name}${sizeStr}`)
            entryCount++
          }
        }
      }

      walk(resolved, '', 0)

      if (entryCount >= MAX_TREE_ENTRIES) {
        lines.push(`... (已达 ${MAX_TREE_ENTRIES} 条目上限，已截断，可用 path 缩小范围或降低 maxDepth)`)
      }
      if (lines.length === 0) return `(空目录: ${target})`
      return lines.join('\n')
    }
  })

  const codeRead = new DynamicStructuredTool({
    name: 'code_read',
    description: '读取工作空间内代码文件内容并标注行号，便于在审查意见中精确引用行号。参数 path 为相对工作空间根的文件路径；startLine/endLine 可选（1-based），指定读取的行范围。返回 "行号: 内容" 格式。单次最多 5 万字符，超大文件请用 startLine/endLine 分段读取。',
    schema: z.object({
      path: z.string().describe('要读取的代码文件相对路径，相对于工作空间根目录'),
      startLine: z.number().nullable().describe('起始行号（1-based），省略或 null 从第 1 行开始'),
      endLine: z.number().nullable().describe('结束行号（1-based），省略或 null 到文件末尾')
    }),
    func: async ({ path: relPath, startLine, endLine }): Promise<string> => {
      const r = ensureRoot()
      if (!r.ok) return r.error!
      const checked = resolveWithinRoot(relPath, r.root!)
      if (!checked.ok) return checked.error!
      const resolved = checked.resolved!
      const protect = checkPathAllowed(resolved)
      if (!protect.ok) return `⛔ 文件防护拦截：该路径命中受保护目录（${protect.protectedPath}）`
      try {
        if (!fs.existsSync(resolved)) return `文件不存在: ${relPath}`
        const stat = fs.statSync(resolved)
        if (!stat.isFile()) return `目标不是文件: ${relPath}`
        const content = fs.readFileSync(resolved, 'utf-8')
        // 二进制检测：UTF-8 解码出现大量替换符则视为非文本
        if (content.includes('\uFFFD')) {
          return `该文件似乎不是文本文件（可能为二进制），无法按代码读取: ${relPath}`
        }
        const allLines = content.split(/\r?\n/)
        const totalLines = allLines.length
        const s = startLine == null ? 1 : Math.max(1, Math.floor(startLine))
        const e = endLine == null ? totalLines : Math.min(totalLines, Math.floor(endLine))
        if (s > totalLines) return `起始行 ${s} 超出文件总行数 ${totalLines}`
        const slice = allLines.slice(s - 1, e)
        const numbered = slice.map((line, i) => `${s + i}: ${line}`)
        const rangeNote = (s !== 1 || e !== totalLines)
          ? `(显示第 ${s}-${e} 行，文件共 ${totalLines} 行)\n`
          : (totalLines > 0 ? `(文件共 ${totalLines} 行)\n` : '')
        let result = rangeNote + numbered.join('\n')
        if (result.length > MAX_CODE_READ_CHARS) {
          result = result.slice(0, MAX_CODE_READ_CHARS) +
            `\n\n... (已截断，本次请求范围 ${s}-${e} 内容过长。请用更窄的 startLine/endLine 分段读取)`
        }
        return result || '(文件内容为空)'
      } catch (err: any) {
        return `读取代码文件失败: ${err.message || String(err)}`
      }
    }
  })

  const codeSearch = new DynamicStructuredTool({
    name: 'code_search',
    description: '在工作空间代码文件中搜索文本或正则（grep）。参数 pattern 为搜索模式；path 为搜索起始目录（省略或 null 从根开始）；globPattern 为文件名过滤（如 "*.ts"）；isRegex 为 true 时把 pattern 当正则。返回 "相对路径:行号: 匹配行"。最多 200 条匹配。适合定位 TODO/FIXME、可疑 API、重复模式等。',
    schema: z.object({
      pattern: z.string().describe('要搜索的文本或正则表达式'),
      path: z.string().nullable().describe('搜索起始目录的相对路径，省略或 null 从工作空间根开始'),
      globPattern: z.string().nullable().describe('文件名 glob 过滤，如 "*.ts" 或 "*.py"，省略搜索所有文件'),
      isRegex: z.boolean().nullable().describe('是否将 pattern 作为正则表达式，true 时启用正则匹配')
    }),
    func: async ({ pattern, path: relPath, globPattern, isRegex }): Promise<string> => {
      const r = ensureRoot()
      if (!r.ok) return r.error!
      const target = relPath || '.'
      const checked = resolveWithinRoot(target, r.root!)
      if (!checked.ok) return checked.error!
      const resolved = checked.resolved!
      const protect = checkPathAllowed(resolved)
      if (!protect.ok) return `⛔ 文件防护拦截：该路径命中受保护目录（${protect.protectedPath}）`
      if (!pattern) return '请提供搜索 pattern'

      let regex: RegExp
      try {
        regex = isRegex === true
          ? new RegExp(pattern)
          : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      } catch (err: any) {
        return `正则表达式无效: ${err.message || String(err)}`
      }

      // glob 简单匹配：支持 *.ext、prefix*.ext 等形式（转 * → .*、? → .）
      let globFn: ((name: string) => boolean) | null = null
      if (globPattern) {
        const g = globPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')
        const gr = new RegExp(`^${g}$`, 'i')
        globFn = (name: string) => gr.test(name)
      }

      const files = walkCodeFiles(resolved, 6, MAX_SEARCH_FILES)
      const results: string[] = []
      let scanned = 0
      for (const relFile of files) {
        if (results.length >= MAX_SEARCH_RESULTS) break
        const fileName = path.basename(relFile)
        if (globFn && !globFn(fileName)) continue
        const abs = path.join(resolved, relFile)
        if (!checkPathAllowed(abs).ok) continue
        let content: string
        try {
          content = fs.readFileSync(abs, 'utf-8')
        } catch {
          continue
        }
        if (content.includes('\uFFFD')) continue // 跳过二进制
        scanned++
        const lines = content.split(/\r?\n/)
        for (let i = 0; i < lines.length; i++) {
          if (results.length >= MAX_SEARCH_RESULTS) break
          if (regex.test(lines[i])) {
            const dispPath = toRel(abs)
            // 截断过长的匹配行，避免单行撑爆输出
            const line = lines[i].length > 300 ? lines[i].slice(0, 300) + ' …' : lines[i]
            results.push(`${dispPath}:${i + 1}: ${line}`)
          }
        }
      }

      if (results.length === 0) {
        return `未找到匹配项（扫描 ${scanned} 个文件，搜索 "${pattern}"）`
      }
      let out = results.join('\n')
      const trunc = results.length >= MAX_SEARCH_RESULTS
        ? `\n\n... (已达 ${MAX_SEARCH_RESULTS} 条上限，已截断。可用 path/globPattern 缩小范围)`
        : `\n\n（共 ${results.length} 条匹配，扫描 ${scanned} 个文件）`
      return out + trunc
    }
  })

  return [codeTree, codeRead, codeSearch] as unknown as Tool[]
}
