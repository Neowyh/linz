import * as kb from '../database/kb'

// ============ 类型 ============
export interface WikiGraphNode {
  slug: string
  title: string
  pageType: string
  linkCount: number
}

export interface WikiGraphEdge {
  source: string
  target: string
}

export interface WikiGraphMeta {
  mode: string
  total: number
  returned: number
  truncated: boolean
  center?: string
  depth?: number
}

export interface WikiGraphData {
  nodes: WikiGraphNode[]
  edges: WikiGraphEdge[]
  meta: WikiGraphMeta
}

export interface WikiGraphRequest {
  mode?: 'overview' | 'ego'
  center?: string
  depth?: number
  limit?: number
  types?: string[]
}

const DEFAULT_LIMIT = 200
const MAX_LIMIT = 500

// ============ Overview 模式：按 link_count 降序取 top-N ============
function computeOverview(
  pages: kb.WikiPageRow[],
  limit: number,
  typeFilter?: Set<string>
): WikiGraphData {
  const pageBySlug = new Map<string, kb.WikiPageRow>()
  const linkCount = new Map<string, number>()

  for (const p of pages) {
    pageBySlug.set(p.slug, p)
    let inLinks: string[] = []
    let outLinks: string[] = []
    try { inLinks = JSON.parse(p.in_links || '[]') } catch { /* ignore */ }
    try { outLinks = JSON.parse(p.out_links || '[]') } catch { /* ignore */ }
    linkCount.set(p.slug, inLinks.length + outLinks.length)
  }

  // 类型过滤
  let candidates = pages
  if (typeFilter && typeFilter.size > 0) {
    candidates = pages.filter((p) => typeFilter.has(p.page_type))
  }

  // 按 link_count 降序，取 top-limit
  const sorted = candidates
    .map((p) => ({ slug: p.slug, count: linkCount.get(p.slug) || 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)

  const selectedSlugs = new Set(sorted.map((s) => s.slug))

  // 构建节点
  const nodes: WikiGraphNode[] = sorted.map((s) => {
    const page = pageBySlug.get(s.slug)!
    return {
      slug: s.slug,
      title: page.title,
      pageType: page.page_type,
      linkCount: s.count
    }
  })

  // 构建边：只保留两端都在 selected 中的 out_links
  const edges: WikiGraphEdge[] = []
  const seenEdges = new Set<string>()
  for (const slug of selectedSlugs) {
    const page = pageBySlug.get(slug)!
    let outLinks: string[] = []
    try { outLinks = JSON.parse(page.out_links || '[]') } catch { /* ignore */ }
    for (const target of outLinks) {
      if (!selectedSlugs.has(target)) continue
      const edgeKey = `${slug}|${target}`
      if (seenEdges.has(edgeKey)) continue
      seenEdges.add(edgeKey)
      edges.push({ source: slug, target })
    }
  }

  return {
    nodes,
    edges,
    meta: {
      mode: 'overview',
      total: pages.length,
      returned: nodes.length,
      truncated: nodes.length < pages.length
    }
  }
}

// ============ Ego 模式：BFS 邻域 ============
function bfsEgo(
  pageBySlug: Map<string, kb.WikiPageRow>,
  center: string,
  depth: number,
  typeFilter: Set<string> | undefined,
  limit: number
): Set<string> {
  const result = new Set<string>()
  const visited = new Set<string>()
  let frontier = [center]

  for (let d = 0; d < depth && frontier.length > 0; d++) {
    const nextFrontier: string[] = []
    for (const slug of frontier) {
      if (visited.has(slug)) continue
      visited.add(slug)

      // 类型过滤：非起始节点受类型限制
      if (d > 0 && typeFilter && typeFilter.size > 0) {
        const page = pageBySlug.get(slug)
        if (page && !typeFilter.has(page.page_type)) continue
      }

      result.add(slug)
      if (result.size >= limit) return result

      // 收集邻居（双向）
      const page = pageBySlug.get(slug)
      if (!page) continue
      let inLinks: string[] = []
      let outLinks: string[] = []
      try { inLinks = JSON.parse(page.in_links || '[]') } catch { /* ignore */ }
      try { outLinks = JSON.parse(page.out_links || '[]') } catch { /* ignore */ }
      for (const neighbor of [...outLinks, ...inLinks]) {
        if (!visited.has(neighbor) && pageBySlug.has(neighbor)) {
          nextFrontier.push(neighbor)
        }
      }
    }
    frontier = nextFrontier
  }

  return result
}

function computeEgo(
  pages: kb.WikiPageRow[],
  center: string,
  depth: number,
  limit: number,
  typeFilter?: Set<string>
): WikiGraphData {
  const pageBySlug = new Map<string, kb.WikiPageRow>()
  const linkCount = new Map<string, number>()
  for (const p of pages) {
    pageBySlug.set(p.slug, p)
    let inLinks: string[] = []
    let outLinks: string[] = []
    try { inLinks = JSON.parse(p.in_links || '[]') } catch { /* ignore */ }
    try { outLinks = JSON.parse(p.out_links || '[]') } catch { /* ignore */ }
    linkCount.set(p.slug, inLinks.length + outLinks.length)
  }

  if (!pageBySlug.has(center)) {
    return { nodes: [], edges: [], meta: { mode: 'ego', total: pages.length, returned: 0, truncated: false } }
  }

  const selected = bfsEgo(pageBySlug, center, depth, typeFilter, limit)

  const nodes: WikiGraphNode[] = []
  for (const slug of selected) {
    const page = pageBySlug.get(slug)!
    nodes.push({
      slug,
      title: page.title,
      pageType: page.page_type,
      linkCount: linkCount.get(slug) || 0
    })
  }

  const edges: WikiGraphEdge[] = []
  const seenEdges = new Set<string>()
  for (const slug of selected) {
    const page = pageBySlug.get(slug)!
    let outLinks: string[] = []
    try { outLinks = JSON.parse(page.out_links || '[]') } catch { /* ignore */ }
    for (const target of outLinks) {
      if (!selected.has(target)) continue
      const edgeKey = `${slug}|${target}`
      if (seenEdges.has(edgeKey)) continue
      seenEdges.add(edgeKey)
      edges.push({ source: slug, target })
    }
  }

  return {
    nodes,
    edges,
    meta: {
      mode: 'ego',
      total: pages.length,
      returned: nodes.length,
      truncated: nodes.length < pages.length,
      center,
      depth
    }
  }
}

// ============ 主入口 ============
export function getWikiGraph(req: WikiGraphRequest = {}): WikiGraphData {
  const mode = req.mode || 'overview'
  const limit = Math.min(Math.max(req.limit || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const depth = Math.max(req.depth || 2, 1)
  const typeFilter = req.types && req.types.length > 0 ? new Set(req.types) : undefined

  const pages = kb.listAllWikiPages()
  if (pages.length === 0) {
    return { nodes: [], edges: [], meta: { mode, total: 0, returned: 0, truncated: false } }
  }

  if (mode === 'ego' && req.center) {
    return computeEgo(pages, req.center, depth, limit, typeFilter)
  }

  return computeOverview(pages, limit, typeFilter)
}
