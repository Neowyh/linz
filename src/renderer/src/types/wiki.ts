// Wiki 知识图谱渲染端类型（与 preload/index.d.ts 的 wiki* API 结构一致）

export interface WikiPage {
  id: string
  slug: string
  title: string
  pageType: string
  content: string | null
  summary: string | null
  inLinks: string[]
  outLinks: string[]
  sourceRefs: string[]
  chunkRefs: string[]
}

export interface WikiPageSummary {
  slug: string
  title: string
  page_type: string
  link_count: number
}

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

export interface WikiProgress {
  total: number
  done: number
  title: string
  status: 'generating' | 'done' | 'skipped' | 'error'
  error?: string
}

export interface WikiStatus {
  hasWiki: boolean
  pageCount: number
}
