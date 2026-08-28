import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import type { AgentContext } from '../base.agent'
import { resolveWithinRoot } from '../../fs/path-guard'
import { checkPathAllowed } from '../../security/file-protection'

const MAX_READ_CHARS = 10000
const BLOCKED_WRITE_EXTS = [
  '.exe', '.bat', '.cmd', '.sh', '.com', '.scr', '.vbs', '.ps1',
  '.dll', '.sys', '.lnk', '.url', '.reg', '.msi', '.jar', '.appx'
]

export interface FilesystemToolDeps {
  context: AgentContext
}

export function createFilesystemTools(deps: FilesystemToolDeps): Tool[] {
  const { context } = deps
  const root = context.fileWorkspacePath

  // 工作空间未设置时，工具返回提示而非报错——LLM 会知道需要让用户先设置
  const ensureRoot = (): { ok: boolean; root?: string; error?: string } => {
    if (!root) {
      return { ok: false, error: '未设置工作空间目录，无法读写文件。请让用户在对话框下方点击"工作空间"按钮选择一个文件夹。' }
    }
    return { ok: true, root }
  }

  const fileRead = new DynamicStructuredTool({
    name: 'file_read',
    description: '读取工作空间内的文本文件内容。参数 path 为相对于工作空间根目录的路径（如 "demo.txt" 或 "subdir/note.md"），仅可读取工作空间目录内的文件。返回文件文本内容（超长会截断）。',
    schema: z.object({
      path: z.string().describe('要读取的文件相对路径，相对于工作空间根目录')
    }),
    func: async ({ path: relPath }): Promise<string> => {
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
        if (content.length > MAX_READ_CHARS) {
          return content.slice(0, MAX_READ_CHARS) + `\n\n... (已截断，原始文件共 ${content.length} 字符)`
        }
        return content || '(文件内容为空)'
      } catch (err: any) {
        return `读取文件失败: ${err.message || String(err)}`
      }
    }
  })

  const fileWrite = new DynamicStructuredTool({
    name: 'file_write',
    description: '将文本内容写入工作空间内的文件（覆盖已存在的文件，自动创建不存在的父目录）。参数 path 为相对路径，content 为要写入的文本。禁止写入可执行文件（.exe/.bat/.sh 等）。返回写入结果。',
    schema: z.object({
      path: z.string().describe('要写入的文件相对路径，相对于工作空间根目录'),
      content: z.string().describe('要写入的文本内容')
    }),
    func: async ({ path: relPath, content }): Promise<string> => {
      const r = ensureRoot()
      if (!r.ok) return r.error!
      const checked = resolveWithinRoot(relPath, r.root!)
      if (!checked.ok) return checked.error!
      const resolved = checked.resolved!
      const protect = checkPathAllowed(resolved)
      if (!protect.ok) return `⛔ 文件防护拦截：该路径命中受保护目录（${protect.protectedPath}）`
      const ext = path.extname(resolved).toLowerCase()
      if (BLOCKED_WRITE_EXTS.includes(ext)) {
        return `禁止写入可执行文件类型: ${ext}`
      }
      try {
        fs.mkdirSync(path.dirname(resolved), { recursive: true })
        fs.writeFileSync(resolved, content, 'utf-8')
        const bytes = Buffer.byteLength(content, 'utf-8')
        return `已写入文件: ${relPath}（${content.length} 字符, ${bytes} 字节）`
      } catch (err: any) {
        return `写入文件失败: ${err.message || String(err)}`
      }
    }
  })

  const fileList = new DynamicStructuredTool({
    name: 'file_list',
    description: '列出工作空间内某目录下的文件和子目录。参数 path 为相对路径，省略或传 null 时列出工作空间根目录。返回每行一个条目：名称/类型(文件|目录)/大小。',
    schema: z.object({
      // OpenAI structured outputs 要求所有字段必填，可选字段用 .nullable() 表达
      path: z.string().nullable().describe('要列出的目录相对路径，省略或 null 时列出工作空间根目录')
    }),
    func: async ({ path: relPath }): Promise<string> => {
      const r = ensureRoot()
      if (!r.ok) return r.error!
      const target = relPath || '.'
      const checked = resolveWithinRoot(target, r.root!)
      if (!checked.ok) return checked.error!
      const resolved = checked.resolved!
      const protect = checkPathAllowed(resolved)
      if (!protect.ok) return `⛔ 文件防护拦截：该路径命中受保护目录（${protect.protectedPath}）`
      try {
        if (!fs.existsSync(resolved)) return `目录不存在: ${target}`
        const stat = fs.statSync(resolved)
        if (!stat.isDirectory()) return `目标不是目录: ${target}`
        const entries = fs.readdirSync(resolved, { withFileTypes: true })
        if (entries.length === 0) return `(空目录: ${target})`
        const lines = entries.map((e) => {
          if (e.isDirectory()) return `${e.name}/\t目录`
          if (e.isFile()) {
            try {
              const size = fs.statSync(path.join(resolved, e.name)).size
              return `${e.name}\t文件\t${size}字节`
            } catch {
              return `${e.name}\t文件`
            }
          }
          return `${e.name}\t其他`
        })
        return lines.join('\n')
      } catch (err: any) {
        return `列目录失败: ${err.message || String(err)}`
      }
    }
  })

  return [fileRead, fileWrite, fileList] as unknown as Tool[]
}
