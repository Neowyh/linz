import { create } from 'zustand'
import type { GraphPayload, GraphNode, GraphEnrichProgress } from '../types/knowledgeGraph'

export interface GraphFilters {
  categories: string[]      // 空 = 全部
  tags: string[]            // 空 = 全部
  threshold: number         // 相似度阈值 0~1
  entitiesOnly: boolean     // 只看 AI 实体
}

interface KnowledgeGraphState {
  graph: GraphPayload | null
  loading: boolean
  error: string | null

  filters: GraphFilters
  searchTerm: string

  // 选中的文档节点 id（doc:xxx 形式），用于对话联动
  selectedIds: string[]
  // 详情抽屉当前打开的节点
  detailNodeId: string | null

  // AI 增强进度
  enriching: boolean
  enrichProgress: GraphEnrichProgress | null

  loadGraph: () => Promise<void>
  setFilters: (partial: Partial<GraphFilters>) => void
  setSearchTerm: (term: string) => void
  setSelectedIds: (ids: string[]) => void
  toggleSelected: (id: string) => void
  clearSelection: () => void
  setDetailNodeId: (id: string | null) => void
  setEnriching: (v: boolean) => void
  setEnrichProgress: (p: GraphEnrichProgress | null) => void
}

export const useKnowledgeGraphStore = create<KnowledgeGraphState>((set, get) => ({
  graph: null,
  loading: false,
  error: null,

  filters: { categories: [], tags: [], threshold: 0.2, entitiesOnly: false },
  searchTerm: '',

  selectedIds: [],
  detailNodeId: null,

  enriching: false,
  enrichProgress: null,

  // 拉取全量图（含所有候选边及其 weight）。只在挂载/AI增强/清除/切库时调用；
  // 阈值等过滤在前端做显隐切换，不触发本函数，保证滑动丝滑。
  loadGraph: async () => {
    set({ loading: true, error: null })
    try {
      const graph = await window.aeromind.kb.graphBuild({ includeEntities: true })
      set({ graph, loading: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loading: false })
    }
  },

  setFilters: (partial) =>
    set((state) => ({ filters: { ...state.filters, ...partial } })),

  setSearchTerm: (term) => set({ searchTerm: term }),

  setSelectedIds: (ids) => set({ selectedIds: ids }),

  toggleSelected: (id) =>
    set((state) => ({
      selectedIds: state.selectedIds.includes(id)
        ? state.selectedIds.filter((x) => x !== id)
        : [...state.selectedIds, id]
    })),

  clearSelection: () => set({ selectedIds: [] }),

  setDetailNodeId: (id) => set({ detailNodeId: id }),

  setEnriching: (v) => set({ enriching: v }),
  setEnrichProgress: (p) => set({ enrichProgress: p })
}))

// 从选中节点 id 提取文档 id（去掉 doc: 前缀；实体节点取其来源文档）
export function selectedDocIds(graph: GraphPayload | null, selectedIds: string[]): string[] {
  if (!graph) return []
  const nodeMap = new Map<string, GraphNode>(graph.nodes.map((n) => [n.id, n]))
  const out = new Set<string>()
  for (const id of selectedIds) {
    const node = nodeMap.get(id)
    if (!node) continue
    if (node.kind === 'document') {
      out.add(id.replace(/^doc:/, ''))
    } else if (node.docIds) {
      for (const d of node.docIds) out.add(d)
    }
  }
  return Array.from(out)
}
