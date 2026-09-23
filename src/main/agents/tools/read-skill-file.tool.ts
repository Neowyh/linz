import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import fs from 'fs'
import path from 'path'
import { findSkillByNameOrId } from '../agent-skills.service'
import { checkPathAllowed } from '../../security/file-protection'

// 渐进披露（progressive disclosure）工具：让 Agent 按需读取技能包内被 SKILL.md 引用的文件。
// 标准技能包的 SKILL.md 是轻量入口，真正的详细内容放在 reference/、assets/ 等子目录，
// 通过 Markdown 链接引用。导入/内置时只把 SKILL.md body 注入提示词，
// Agent 在需要时用本工具按包内相对路径读取被引用的文件，而非一次性全量内联。

const MAX_READ_CHARS = 50000

export const readSkillFileTool = new DynamicStructuredTool({
  name: 'read_skill_file',
  description: '读取技能包内被 SKILL.md 引用的文件（渐进披露）。当技能内容中提到 reference/xxx.md、assets/xxx.md 等链接、且需要查看详细内容时使用。参数 skill 为技能名称，path 为技能包内文件的相对路径（如 "reference/react.md" 或 "assets/review-checklist.md"）。若 path 指向目录则列出其内容。',
  schema: z.object({
    skill: z.string().describe('技能名称或 id（与提示词中 ### 后的技能名一致）'),
    path: z.string().describe('技能包内文件的相对路径，如 "reference/react.md"')
  }),
  func: async ({ skill, path: relPath }): Promise<string> => {
    if (!skill?.trim() || !relPath?.trim()) {
      return '参数不完整：需要 skill（技能名称）和 path（包内相对路径）'
    }

    const s = findSkillByNameOrId(skill)
    if (!s) return `未找到启用中的技能「${skill}」`
    if (!s.package_path) return `技能「${s.name}」没有技能包目录（手动创建的技能不附带文件）`

    // 文件防护：技能包目录命中受保护路径则拦截
    const protectPkg = checkPathAllowed(s.package_path)
    if (!protectPkg.ok) return `⛔ 文件防护拦截：技能包目录命中受保护路径（${protectPkg.protectedPath}）`

    // 路径校验：文件必须位于 package_path 内，防目录穿越
    const normPath = relPath.replace(/\\/g, '/').replace(/^\/+/, '')
    const filePath = path.resolve(s.package_path, normPath)
    const rel = path.relative(s.package_path, filePath)
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      return '路径非法：只能读取技能包目录内的文件'
    }

    const protectFile = checkPathAllowed(filePath)
    if (!protectFile.ok) return `⛔ 文件防护拦截：文件路径命中受保护路径（${protectFile.protectedPath}）`

    try {
      if (!fs.existsSync(filePath)) return `文件不存在: ${relPath}（请检查路径是否正确，或用目录路径列出可用文件）`
      const stat = fs.statSync(filePath)
      if (stat.isDirectory()) {
        const entries = fs.readdirSync(filePath, { withFileTypes: true })
          .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
          .sort()
        return `(目录: ${relPath})\n${entries.join('\n')}`
      }
      if (!stat.isFile()) return `目标不是常规文件: ${relPath}`

      const content = fs.readFileSync(filePath, 'utf-8')
      // 二进制检测：UTF-8 解码出现大量替换符则视为非文本
      if (content.includes('\uFFFD')) {
        return `该文件似乎不是文本文件（可能为二进制），无法读取: ${relPath}`
      }
      if (content.length > MAX_READ_CHARS) {
        return content.slice(0, MAX_READ_CHARS) + `\n\n... (已截断，原始文件共 ${content.length} 字符)`
      }
      return content || '(文件内容为空)'
    } catch (err: any) {
      return `读取技能包文件失败: ${err.message || String(err)}`
    }
  }
})
