// 知识图谱渲染端类型（与 preload/index.d.ts 的 GraphPayload 结构保持一致）
export interface GraphNode {
  id: string
  kind: 'document' | 'entity'
  label: string
  category?: string
  tags?: string[]
  chunkCount?: number
  entityType?: string
  docIds?: string[]
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'similar' | 'relation' | 'mentions'
  weight?: number
  label?: string
}

export interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
  entityCount: number
}

export interface GraphEnrichProgress {
  total: number
  done: number
  fileName: string
  status: 'extracting' | 'done' | 'skipped' | 'error'
  error?: string
}

export interface GraphChunk {
  content: string
  chunk_index: number
}
