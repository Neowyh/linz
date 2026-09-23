import crypto from 'crypto'
import { v4 as uuidv4 } from 'uuid'
import * as kb from '../database/kb'
import { createChatModel } from '../llm'
import { streamChat } from '../llm/stream-handler'

// ============ 类型 ============
export interface WikiProgress {
  total: number
  done: number
  title: string
  status: 'generating' | 'done' | 'skipped' | 'error'
  error?: string
}

export interface WikiSummary {
  pages: number
  done: number
  skipped: number
  failed: number
}

interface EntityInfo {
  id: string
  name: string
  type: string
  documentId: string
  slug: string
  relatedEntities: Array<{ slug: string; name: string; relationLabel: string }>
}

// ============ 常量 ============
const ENRICH_INPUT_MAX_CHARS = 2500
const PAGE_TYPE_MAP: Record<string, string> = {
  '技术': 'concept',
  '概念': 'concept',
  '部件': 'entity',
  '材料': 'entity',
  '参数': 'entity',
  '标准': 'concept'
}
const DEFAULT_PAGE_TYPE = 'entity'

// ============ 辅助函数 ============
function sha1(text: string): string {
  return crypto.createHash('sha1').update(text).digest('hex')
}

function normalizeEntityName(name: string): string {
  return name.trim().replace(/\s+/g, '')
}

function slugify(name: string): string {
  return kb.wikiSlug(name)
}

// 采样：前 3 块 + 中 1 块 + 末 1 块，总字符硬上限
function sampleChunks(chunkContents: string[]): string {
  if (chunkContents.length === 0) return ''
  const picked: string[] = []
  const idx = new Set<number>()
  const add = (i: number): void => {
    if (i >= 0 && i < chunkContents.length && !idx.has(i)) {
      idx.add(i)
      picked.push(chunkContents[i])
    }
  }
  for (let i = 0; i < Math.min(3, chunkContents.length); i++) add(i)
  add(Math.floor(chunkContents.length / 2))
  add(chunkContents.length - 1)

  let text = picked.join('\n\n')
  if (text.length > ENRICH_INPUT_MAX_CHARS) {
    text = text.slice(0, ENRICH_INPUT_MAX_CHARS) + '\n...(已截断)'
  }
  return text
}

// 解析 [[slug|name]] 或 [[slug]] 格式的 wiki 链接
const WIKILINK_RE = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g
function parseWikiLinks(content: string): string[] {
  const slugs: string[] = []
  let match: RegExpExecArray | null
  WIKILINK_RE.lastIndex = 0
  while ((match = WIKILINK_RE.exec(content)) !== null) {
    const slug = match[1].trim()
    if (slug) slugs.push(slug)
  }
  return [...new Set(slugs)]
}

// 从内容中提取 SUMMARY 行（首行 SUMMARY: xxx）
function extractSummary(content: string): string {
  const match = content.match(/^SUMMARY:\s*(.+)$/m)
  return match ? match[1].trim() : content.split('\n')[0].replace(/^#+\s*/, '').trim().slice(0, 100)
}

// 清理内容中的 SUMMARY 行（正文不包含它）
function stripSummaryLine(content: string): string {
  return content.replace(/^SUMMARY:\s*.+\n?/m, '')
}

// ============ 构建实体信息（含关系映射） ============
function buildEntityInfos(): EntityInfo[] {
  const entities = kb.listGraphEntities()
  const relations = kb.listGraphRelations()

  // 构建实体 ID → 信息映射
  const entityMap = new Map<string, { name: string; type: string; documentId: string; slug: string }>()
  for (const e of entities) {
    entityMap.set(e.id, {
      name: e.name,
      type: e.entity_type || DEFAULT_PAGE_TYPE,
      documentId: e.document_id,
      slug: slugify(e.name)
    })
  }

  // 构建关系映射：entityId → [{ slug, name, relationLabel }]
  const relationMap = new Map<string, Array<{ slug: string; name: string; relationLabel: string }>>()
  for (const r of relations) {
    // source → target
    const srcInfo = entityMap.get(r.source_entity)
    const tgtInfo = entityMap.get(r.target_entity)
    if (!srcInfo || !tgtInfo) continue

    // source 的相关实体
    let srcRels = relationMap.get(r.source_entity)
    if (!srcRels) { srcRels = []; relationMap.set(r.source_entity, srcRels) }
    srcRels.push({ slug: tgtInfo.slug, name: tgtInfo.name, relationLabel: r.relation_label })

    // target 的相关实体（反向关系）
    let tgtRels = relationMap.get(r.target_entity)
    if (!tgtRels) { tgtRels = []; relationMap.set(r.target_entity, tgtRels) }
    tgtRels.push({ slug: srcInfo.slug, name: srcInfo.name, relationLabel: r.relation_label })
  }

  return entities.map((e) => {
    const info = entityMap.get(e.id)!
    return {
      id: e.id,
      name: info.name,
      type: info.type,
      documentId: info.documentId,
      slug: info.slug,
      relatedEntities: relationMap.get(e.id) || []
    }
  })
}

// ============ LLM 页面生成 ============
const PAGE_SYSTEM_PROMPT = `你是飞行器设计领域的知识工程师。根据提供的文档片段，为指定实体撰写一个知识页面。

要求：
- 严格基于文档原文内容，不要编造信息
- 第一行写 SUMMARY: 加一句话摘要（不超过 50 字）
- 正文使用 Markdown 格式，包含实体的定义、特点、应用场景等
- 提到相关实体时，使用 [[slug|显示名]] 格式的 wiki 链接
- 不要输出代码围栏，不要输出任何解释，直接输出 Markdown 内容
- 内容控制在 300-500 字`

function buildPageUserPrompt(entity: EntityInfo, fileName: string, sampleText: string): string {
  const relatedList = entity.relatedEntities.length > 0
    ? entity.relatedEntities.map((r) => `- [[${r.slug}|${r.name}]]（关系：${r.relationLabel}）`).join('\n')
    : '无'

  return `实体名称：${entity.name}
实体类型：${entity.type}
来源文档：${fileName}

相关实体（在正文中提到时请使用 [[slug|名称]] 链接）：
${relatedList}

文档片段：
${sampleText}`
}

async function generatePageContent(entity: EntityInfo, fileName: string, sampleText: string): Promise<string> {
  const llm = createChatModel({ timeout: 90000 })
  const userMessage = buildPageUserPrompt(entity, fileName, sampleText)
  let output = ''
  for await (const chunk of streamChat(llm, { systemPrompt: PAGE_SYSTEM_PROMPT, userMessage })) {
    if (typeof chunk === 'string') output += chunk
  }
  return output.trim()
}

// ============ 索引页生成（无 LLM，纯结构化） ============
function generateIndexPage(entities: EntityInfo[]): { content: string; summary: string } {
  const byType = new Map<string, EntityInfo[]>()
  for (const e of entities) {
    const pageType = PAGE_TYPE_MAP[e.type] || DEFAULT_PAGE_TYPE
    let group = byType.get(pageType)
    if (!group) { group = []; byType.set(pageType, group) }
    group.push(e)
  }

  const typeLabels: Record<string, string> = {
    entity: '部件与材料',
    concept: '技术与概念'
  }

  let content = `# 知识库索引\n\n本 Wiki 由 ${entities.length} 个知识条目组成，按类型分组如下。\n\n`
  for (const [pageType, group] of byType) {
    const label = typeLabels[pageType] || pageType
    content += `## ${label}\n\n`
    for (const e of group) {
      content += `- [[${e.slug}|${e.name}]]\n`
    }
    content += '\n'
  }

  const summary = `知识库索引，共 ${entities.length} 个条目`
  return { content, summary }
}

// ============ 链接解析与反链计算 ============
function resolveLinks(): void {
  const allPages = kb.listAllWikiPages()
  const existingSlugs = new Set(allPages.map((p) => p.slug))

  // 解析每个页面的 out_links，清理死链
  const outLinkMap = new Map<string, string[]>()
  for (const page of allPages) {
    if (!page.content) {
      outLinkMap.set(page.slug, [])
      continue
    }
    const parsed = parseWikiLinks(page.content)
    // 只保留指向真实存在的页面的链接
    const validLinks = parsed.filter((s) => existingSlugs.has(s))
    outLinkMap.set(page.slug, [...new Set(validLinks)])
  }

  // 反向计算 in_links
  const inLinkMap = new Map<string, Set<string>>()
  for (const slug of existingSlugs) {
    inLinkMap.set(slug, new Set())
  }
  for (const [sourceSlug, targets] of outLinkMap) {
    for (const targetSlug of targets) {
      inLinkMap.get(targetSlug)?.add(sourceSlug)
    }
  }

  // 批量更新
  for (const page of allPages) {
    const outLinks = outLinkMap.get(page.slug) || []
    const inLinks = Array.from(inLinkMap.get(page.slug) || [])
    kb.updateWikiLinks(page.slug, inLinks, outLinks)
  }
}

// ============ 主入口：Wiki 生成 ============
export async function generateWiki(
  onProgress?: (p: WikiProgress) => void
): Promise<WikiSummary> {
  // 1. 构建实体信息
  const entities = buildEntityInfos()
  if (entities.length === 0) {
    return { pages: 0, done: 0, skipped: 0, failed: 0 }
  }

  // 清空旧 Wiki
  kb.deleteAllWikiPages()

  let done = 0
  let skipped = 0
  let failed = 0
  const total = entities.length

  // 2. 逐实体生成页面
  for (let i = 0; i < entities.length; i++) {
    const entity = entities[i]
    const base = { total, done: i, title: entity.name }

    // 获取来源文档块
    const chunkContents = kb.getAllChunkContents(entity.documentId)
    const sampleText = sampleChunks(chunkContents)
    if (!sampleText) {
      failed++
      onProgress?.({ ...base, status: 'error', error: '无文档内容' })
      continue
    }

    const fileName = kb.getFileName(entity.documentId)

    onProgress?.({ ...base, status: 'generating' })

    try {
      // 内容指纹：实体ID + 来源文档块摘要
      const contentHash = sha1(`${entity.id}|${sampleText.slice(0, 500)}`)
      const existing = kb.getWikiPage(entity.slug)
      if (existing && existing.content_hash === contentHash && existing.content) {
        // 内容未变，跳过
        skipped++
        onProgress?.({ ...base, done: i + 1, status: 'skipped' })
        continue
      }

      const rawContent = await generatePageContent(entity, fileName, sampleText)
      const summary = extractSummary(rawContent)
      const content = stripSummaryLine(rawContent)
      const pageType = PAGE_TYPE_MAP[entity.type] || DEFAULT_PAGE_TYPE

      kb.createWikiPage({
        id: uuidv4(),
        slug: entity.slug,
        title: entity.name,
        pageType,
        content,
        summary,
        outLinks: [], // 链接解析阶段统一更新
        sourceRefs: [entity.documentId],
        contentHash
      })

      done++
      onProgress?.({ ...base, done: i + 1, status: 'done' })
    } catch (err) {
      failed++
      const message = err instanceof Error ? err.message : String(err)
      console.warn(`[Wiki] Page generation failed for ${entity.name}:`, message)
      onProgress?.({ ...base, done: i + 1, status: 'error', error: message })
    }
  }

  // 3. 生成索引页
  const indexContent = generateIndexPage(entities)
  kb.createWikiPage({
    id: uuidv4(),
    slug: 'wiki_index',
    title: '知识库索引',
    pageType: 'index',
    content: indexContent.content,
    summary: indexContent.summary,
    outLinks: entities.map((e) => e.slug),
    sourceRefs: [],
    contentHash: sha1(`index|${entities.length}`)
  })

  // 4. 链接解析与反链计算
  resolveLinks()

  return { pages: kb.countWikiPages(), done, skipped, failed }
}
