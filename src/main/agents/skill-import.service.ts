import fs from 'fs'
import path from 'path'
import { unzipSync, strFromU8 } from 'fflate'
import { listAllSkills, createSkill, setSkillPackagePath } from './agent-skills.service'

// 技能包来源（确认导入时据此把 scripts/references 等落盘，供 run_skill_script 工具执行）
export type PackageSource =
  | { kind: 'dir'; dir: string }
  | { kind: 'zip'; zipPath: string; prefix: string }

// 解析出的待导入技能候选（导入预览弹窗的数据源）
export interface SkillCandidate {
  sourcePath: string        // 来源描述（文件路径或 zip 内路径）
  name: string
  description: string
  content: string
  suggestedKeywords: string[]
  warnings: string[]
  duplicate: boolean        // 与现有技能重名（确认导入时自动加后缀）
  packageSource?: PackageSource
  scriptNames: string[]     // 附带的脚本文件（预览展示；确认导入后落盘，可由 run_skill_script 执行）
}

// 单个技能附带的 references 内联总量上限，防止 zip 技能包撑爆 prompt
const REFERENCES_TOTAL_LIMIT = 50 * 1024

// === SKILL.md 解析 ===

// 解析 YAML frontmatter（仅取顶层标量 name/description，嵌套结构忽略）
// 标准格式：---\nname: xxx\ndescription: yyy\n---\n正文
function parseSkillMarkdown(raw: string, fallbackName: string): { name: string; description: string; body: string } {
  const fmMatch = raw.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/)
  let name = ''
  let description = ''
  let body = raw
  if (fmMatch) {
    body = raw.slice(fmMatch[0].length)
    for (const line of fmMatch[1].split(/\r?\n/)) {
      // 跳过多行/嵌套字段（缩进行），只取顶层 key: value
      if (/^\s/.test(line)) continue
      const kv = line.match(/^([A-Za-z_-]+)\s*:\s*(.*)$/)
      if (!kv) continue
      const key = kv[1].toLowerCase()
      // 去掉成对引号
      const value = kv[2].trim().replace(/^(['"])([\s\S]*)\1$/, '$2')
      if (key === 'name') name = value
      else if (key === 'description') description = value
    }
  }
  return { name: name || fallbackName, description, body: body.trim() }
}

// === 关键词候选提取 ===

const EN_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'when', 'how', 'use', 'used', 'using',
  'you', 'your', 'are', 'can', 'will', 'from', 'into', 'skill', 'agent',
  // 常见虚词/介词/代词（单字母 token 不会被正则捕获，无需列 a/i）
  'or', 'an', 'of', 'to', 'in', 'on', 'by', 'as', 'at', 'be', 'is', 'it', 'its',
  'if', 'so', 'then', 'than', 'do', 'go', 'we', 'us', 'all', 'any', 'each', 'some',
  'more', 'most', 'other', 'such', 'only', 'new', 'own', 'same', 'both', 'via', 'may',
  // 描述动作的低信号动词（常见于技能说明，但几乎不是用户查询词）
  'build', 'inspect', 'reproduce', 'create', 'make', 'made', 'write', 'read', 'run',
  'open', 'close', 'save', 'load', 'start', 'stop', 'get', 'set', 'add', 'remove',
  'check', 'ensure', 'verify', 'work', 'look', 'need', 'want', 'find', 'show'
])

// 从 name/description 提取触发关键词候选，导入预览时由用户确认/编辑
// 规则：技能名称本身 + 英文/型号 token（NACA、XFOIL、Cl/Cd 等）+ 引号包裹短语
function suggestKeywords(name: string, description: string): string[] {
  const kws = new Set<string>()
  const trimmedName = (name || '').trim()
  if (trimmedName) kws.add(trimmedName)

  const text = `${name}\n${description || ''}`
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9_\-/]{1,}/g)) {
    const token = m[0]
    if (EN_STOPWORDS.has(token.toLowerCase())) continue
    kws.add(token)
  }
  for (const m of text.matchAll(/[「『“"']([^「」『』“”"']{2,12})[」』”"']/g)) {
    kws.add(m[1].trim())
  }
  return [...kws].filter(Boolean).slice(0, 8)
}

// === 附带资源处理 ===

interface ResourceAccessor {
  // 返回某技能目录下 references/*.md 列表（相对名 → 文本内容）
  listReferenceDocs(): Array<{ relName: string; text: string }>
  // 返回 scripts/ 下文件名列表
  listScriptNames(): string[]
}

// 把 references 内联进技能正文（脚本不入正文——落盘后由 run_skill_script 工具执行）
function assembleContent(body: string, resources: ResourceAccessor, warnings: string[]): string {
  let content = body

  let total = 0
  for (const ref of resources.listReferenceDocs()) {
    if (total >= REFERENCES_TOTAL_LIMIT) {
      warnings.push(`参考资料超出 ${Math.round(REFERENCES_TOTAL_LIMIT / 1024)}KB 上限，部分文件未内联`)
      break
    }
    const remaining = REFERENCES_TOTAL_LIMIT - total
    const text = ref.text.length > remaining ? ref.text.slice(0, remaining) : ref.text
    if (ref.text.length > remaining) {
      warnings.push(`参考资料 ${ref.relName} 已截断（总量上限 ${Math.round(REFERENCES_TOTAL_LIMIT / 1024)}KB）`)
    }
    total += text.length
    content += `\n\n---\n\n## 参考资料：${ref.relName}\n\n${text.trim()}`
  }

  return content
}

// 目录来源的资源访问器
function dirResources(dir: string): ResourceAccessor {
  return {
    listReferenceDocs() {
      const refDir = path.join(dir, 'references')
      const docs: Array<{ relName: string; text: string }> = []
      try {
        if (!fs.statSync(refDir).isDirectory()) return docs
      } catch {
        return docs
      }
      for (const f of fs.readdirSync(refDir).sort()) {
        if (!/\.md$/i.test(f)) continue
        try {
          docs.push({ relName: f, text: fs.readFileSync(path.join(refDir, f), 'utf-8') })
        } catch { /* 单个文件读取失败跳过 */ }
      }
      return docs
    },
    listScriptNames() {
      const scriptDir = path.join(dir, 'scripts')
      try {
        if (!fs.statSync(scriptDir).isDirectory()) return []
        return fs.readdirSync(scriptDir).filter((f) => fs.statSync(path.join(scriptDir, f)).isFile()).sort()
      } catch {
        return []
      }
    }
  }
}

// zip 内某技能目录的资源访问器（entries 为 zip 全部路径 → 内容）
function zipResources(entries: Record<string, Uint8Array>, skillDirPrefix: string): ResourceAccessor {
  const refPrefix = `${skillDirPrefix}references/`
  const scriptPrefix = `${skillDirPrefix}scripts/`
  return {
    listReferenceDocs() {
      const docs: Array<{ relName: string; text: string }> = []
      for (const p of Object.keys(entries).sort()) {
        if (!p.startsWith(refPrefix) || !/\.md$/i.test(p)) continue
        const relName = p.slice(refPrefix.length)
        if (!relName || relName.includes('/')) continue  // 只取 references 直属文件
        try {
          docs.push({ relName, text: strFromU8(entries[p]) })
        } catch { /* 解码失败跳过 */ }
      }
      return docs
    },
    listScriptNames() {
      const names: string[] = []
      for (const p of Object.keys(entries).sort()) {
        if (!p.startsWith(scriptPrefix)) continue
        const relName = p.slice(scriptPrefix.length)
        if (relName && !relName.includes('/') && !relName.startsWith('.')) names.push(relName)
      }
      return names
    }
  }
}

// === 三种来源解析 ===

function makeCandidate(opts: {
  sourcePath: string
  name: string
  description: string
  content: string
  warnings: string[]
  existingNames: Set<string>
  packageSource?: PackageSource
  scriptNames?: string[]
}): SkillCandidate {
  return {
    sourcePath: opts.sourcePath,
    name: opts.name,
    description: opts.description,
    content: opts.content,
    suggestedKeywords: suggestKeywords(opts.name, opts.description),
    warnings: opts.warnings,
    duplicate: opts.existingNames.has(opts.name.trim().toLowerCase()),
    packageSource: opts.packageSource,
    scriptNames: opts.scriptNames || []
  }
}

function candidateFromMarkdown(
  raw: string,
  fallbackName: string,
  sourcePath: string,
  resources: ResourceAccessor | null,
  existingNames: Set<string>,
  packageSource?: PackageSource
): SkillCandidate {
  const warnings: string[] = []
  const { name, description, body } = parseSkillMarkdown(raw, fallbackName)
  const content = resources ? assembleContent(body, resources, warnings) : body
  const scriptNames = resources ? resources.listScriptNames() : []
  return makeCandidate({ sourcePath, name, description, content, warnings, existingNames, packageSource, scriptNames })
}

// 解析单个目录：根目录有 SKILL.md → 单技能；否则递归扫描所有子目录，
// 凡含 SKILL.md 的目录都作为一个技能候选（支持 Codex 插件 skills/<plugin>/skills/<skill>/SKILL.md 嵌套）
function collectFromDirectory(dir: string, existingNames: Set<string>): SkillCandidate[] {
  const rootSkill = findSkillMd(dir)
  if (rootSkill) {
    return [candidateFromMarkdown(
      fs.readFileSync(rootSkill, 'utf-8'),
      path.basename(dir),
      dir,
      dirResources(dir),
      existingNames,
      { kind: 'dir', dir }
    )]
  }
  const candidates: SkillCandidate[] = []
  const walk = (d: string): void => {
    for (const sub of fs.readdirSync(d).sort()) {
      if (sub.startsWith('.')) continue  // 跳过 .codex-plugin / .git 等隐藏目录
      const subDir = path.join(d, sub)
      try {
        if (!fs.statSync(subDir).isDirectory()) continue
      } catch {
        continue
      }
      const skillFile = findSkillMd(subDir)
      if (skillFile) {
        try {
          candidates.push(candidateFromMarkdown(
            fs.readFileSync(skillFile, 'utf-8'),
            sub,
            skillFile,
            dirResources(subDir),
            existingNames,
            { kind: 'dir', dir: subDir }
          ))
        } catch { /* 单个技能读取失败跳过 */ }
      } else {
        walk(subDir)  // 递归下钻
      }
    }
  }
  walk(dir)
  return candidates
}

function findSkillMd(dir: string): string | null {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.toLowerCase() === 'skill.md') return path.join(dir, f)
    }
  } catch { /* 目录不可读 */ }
  return null
}

// 解析 zip：扫描所有 **/SKILL.md（支持一个 zip 含多个技能的技能包）
function collectFromZip(zipPath: string, existingNames: Set<string>): SkillCandidate[] {
  const entries = unzipSync(new Uint8Array(fs.readFileSync(zipPath)))
  const candidates: SkillCandidate[] = []
  for (const p of Object.keys(entries).sort()) {
    const segments = p.split('/').filter(Boolean)
    if (segments.length === 0) continue
    if (segments[segments.length - 1].toLowerCase() !== 'skill.md') continue
    const skillDirPrefix = segments.slice(0, -1).join('/')
    const prefix = skillDirPrefix ? `${skillDirPrefix}/` : ''
    const fallbackName = segments.length >= 2 ? segments[segments.length - 2] : path.basename(zipPath, path.extname(zipPath))
    try {
      candidates.push(candidateFromMarkdown(
        strFromU8(entries[p]),
        fallbackName,
        `${path.basename(zipPath)}:${p}`,
        zipResources(entries, prefix),
        existingNames,
        { kind: 'zip', zipPath, prefix }
      ))
    } catch { /* 单个技能解码失败跳过 */ }
  }
  return candidates
}

// === 对外入口 ===

// 解析用户选择的路径（.md 文件 / 文件夹 / .zip），返回候选列表供预览确认
export function parseImportPaths(paths: string[]): { candidates: SkillCandidate[]; errors: string[] } {
  const existingNames = new Set(listAllSkills().map((s) => s.name.trim().toLowerCase()))
  const candidates: SkillCandidate[] = []
  const errors: string[] = []

  for (const p of paths) {
    try {
      const stat = fs.statSync(p)
      if (stat.isDirectory()) {
        const found = collectFromDirectory(p, existingNames)
        if (found.length === 0) errors.push(`${p}：未找到 SKILL.md`)
        candidates.push(...found)
      } else if (/\.zip$/i.test(p)) {
        const found = collectFromZip(p, existingNames)
        if (found.length === 0) errors.push(`${path.basename(p)}：压缩包内未找到 SKILL.md`)
        candidates.push(...found)
      } else if (/\.md$/i.test(p)) {
        // 单文件导入时，若它是某个技能目录下的 SKILL.md，顺带处理同级 references/scripts 并落盘整个技能目录
        const parentDir = path.dirname(p)
        const isSkillMd = path.basename(p).toLowerCase() === 'skill.md'
        candidates.push(candidateFromMarkdown(
          fs.readFileSync(p, 'utf-8'),
          isSkillMd ? path.basename(parentDir) : path.basename(p, path.extname(p)),
          p,
          isSkillMd ? dirResources(parentDir) : null,
          existingNames,
          isSkillMd ? { kind: 'dir', dir: parentDir } : undefined
        ))
      } else {
        errors.push(`${path.basename(p)}：不支持的格式（仅支持 .md / .zip / 文件夹）`)
      }
    } catch (err: any) {
      errors.push(`${path.basename(p)}：${err?.message || '读取失败'}`)
    }
  }

  return { candidates, errors }
}

export interface ConfirmImportItem {
  name: string
  description?: string
  content: string
  triggerKeywords?: string[]
  packageSource?: PackageSource
}

// 技能包落盘根目录：userData/skill-packages/<skillId>
// 延迟 require electron，避免在纯 Node 环境（单元测试）加载时崩溃
function getSkillPackagesRoot(): string {
  const { app } = require('electron')
  return path.join(app.getPath('userData'), 'skill-packages')
}

// 把技能包（scripts/references 等）落盘到 targetDir
function materializePackage(source: PackageSource, targetDir: string): void {
  fs.rmSync(targetDir, { recursive: true, force: true })
  fs.mkdirSync(targetDir, { recursive: true })

  if (source.kind === 'dir') {
    fs.cpSync(source.dir, targetDir, { recursive: true })
    return
  }

  const entries = unzipSync(new Uint8Array(fs.readFileSync(source.zipPath)))
  for (const [p, data] of Object.entries(entries)) {
    if (!p.startsWith(source.prefix)) continue
    const rel = p.slice(source.prefix.length)
    const segments = rel.split('/').filter(Boolean)
    // 防 zip slip：拒绝带 .. 的路径
    if (segments.length === 0 || segments.some((s) => s === '..')) continue
    const outPath = path.join(targetDir, ...segments)
    fs.mkdirSync(path.dirname(outPath), { recursive: true })
    fs.writeFileSync(outPath, Buffer.from(data))
  }
}

// 确认导入：重名自动加 " (n)" 后缀；带技能包来源的落盘到 userData/skill-packages/<id>
export function confirmImport(items: ConfirmImportItem[]): { imported: number; names: string[] } {
  const usedNames = new Set(listAllSkills().map((s) => s.name.trim().toLowerCase()))
  const names: string[] = []

  for (const item of items) {
    if (!item.name?.trim() || !item.content?.trim()) continue
    let name = item.name.trim()
    if (usedNames.has(name.toLowerCase())) {
      let n = 2
      while (usedNames.has(`${name} (${n})`.toLowerCase())) n++
      name = `${name} (${n})`
    }
    usedNames.add(name.toLowerCase())
    const skill = createSkill({
      name,
      description: item.description || '',
      content: item.content,
      triggerKeywords: item.triggerKeywords || []
    })
    if (item.packageSource) {
      try {
        const targetDir = path.join(getSkillPackagesRoot(), skill.id)
        materializePackage(item.packageSource, targetDir)
        setSkillPackagePath(skill.id, targetDir)
      } catch (err) {
        // 落盘失败不阻塞导入：技能文本仍可用，仅脚本不可执行
        console.warn(`[SkillImport] 技能包落盘失败（${name}）:`, err)
      }
    }
    names.push(name)
  }

  return { imported: names.length, names }
}

// 导出为标准 SKILL.md（frontmatter + 正文）
export function buildSkillMarkdown(skill: { name: string; description: string | null; content: string }): string {
  // description 恒加引号，避免含冒号/特殊字符破坏 YAML
  const desc = (skill.description || '').replace(/"/g, '\\"')
  return `---\nname: ${skill.name}\ndescription: "${desc}"\n---\n\n${skill.content.trim()}\n`
}
