import { create } from 'zustand'
import type { WikiPage, WikiPageSummary, WikiGraphData, WikiGraphRequest, WikiProgress, WikiStatus } from '../types/wiki'

interface WikiState {
  graph: WikiGraphData | null
  currentPage: WikiPage | null
  pages: WikiPageSummary[]
  status: WikiStatus | null
  generating: boolean
  generateProgress: WikiProgress | null
  graphMode: 'overview' | 'ego'
  selectedSlug: string | null
  loadingGraph: boolean
  loadingPage: boolean
  error: string | null

  loadGraph: (options?: WikiGraphRequest) => Promise<void>
  loadPage: (slug: string) => Promise<void>
  loadStatus: () => Promise<void>
  loadPages: () => Promise<void>
  generate: () => Promise<void>
  deleteAll: () => Promise<void>
  setGraphMode: (mode: 'overview' | 'ego') => void
  setSelectedSlug: (slug: string | null) => void
  setGenerateProgress: (p: WikiProgress | null) => void
}

export const useWikiStore = create<WikiState>((set, get) => ({
  graph: null,
  currentPage: null,
  pages: [],
  status: null,
  generating: false,
  generateProgress: null,
  graphMode: 'overview',
  selectedSlug: null,
  loadingGraph: false,
  loadingPage: false,
  error: null,

  loadGraph: async (options) => {
    set({ loadingGraph: true, error: null })
    try {
      const mode = options?.mode || get().graphMode
      const graph = await window.aeromind.kb.wikiGetGraph({ ...options, mode })
      set({ graph, loadingGraph: false })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loadingGraph: false })
    }
  },

  loadPage: async (slug) => {
    set({ loadingPage: true })
    try {
      const page = await window.aeromind.kb.wikiGetPage(slug)
      set({ currentPage: page, loadingPage: false, selectedSlug: slug })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err), loadingPage: false })
    }
  },

  loadStatus: async () => {
    try {
      const status = await window.aeromind.kb.wikiStatus()
      set({ status })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  loadPages: async () => {
    try {
      const pages = await window.aeromind.kb.wikiListPages()
      set({ pages })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  generate: async () => {
    set({ generating: true, generateProgress: null, error: null })
    try {
      const result = await window.aeromind.kb.wikiGenerate()
      set({ generating: false })
      // 生成完成后刷新状态和图谱
      await get().loadStatus()
      await get().loadGraph()
      await get().loadPages()
      return result
    } catch (err) {
      set({
        generating: false,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  },

  deleteAll: async () => {
    try {
      await window.aeromind.kb.wikiDeleteAll()
      set({ graph: null, currentPage: null, pages: [], status: { hasWiki: false, pageCount: 0 }, selectedSlug: null })
    } catch (err) {
      set({ error: err instanceof Error ? err.message : String(err) })
    }
  },

  setGraphMode: (mode) => set({ graphMode: mode }),
  setSelectedSlug: (slug) => set({ selectedSlug: slug }),
  setGenerateProgress: (p) => set({ generateProgress: p })
}))
