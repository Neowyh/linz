import { useEffect, useMemo, useRef, useCallback } from 'react'
import { Empty, Spin, Button, message } from 'antd'
import { ApartmentOutlined } from '@ant-design/icons'
import GraphCanvas, { type GraphCanvasHandle } from './GraphCanvas'
import GraphToolbar from './GraphToolbar'
import GraphFilterPanel from './GraphFilterPanel'
import NodeDetailDrawer from './NodeDetailDrawer'
import GraphAskPanel from './GraphAskPanel'
import { useKnowledgeGraphStore, selectedDocIds } from '../../stores/knowledgeGraphStore'
import type { GraphNode } from '../../types/knowledgeGraph'

export default function KbGraphTab(): JSX.Element {
  const graph = useKnowledgeGraphStore((s) => s.graph)
  const loading = useKnowledgeGraphStore((s) => s.loading)
  const error = useKnowledgeGraphStore((s) => s.error)
  const filters = useKnowledgeGraphStore((s) => s.filters)
  const searchTerm = useKnowledgeGraphStore((s) => s.searchTerm)
  const selectedIds = useKnowledgeGraphStore((s) => s.selectedIds)
  const loadGraph = useKnowledgeGraphStore((s) => s.loadGraph)
  const setDetailNodeId = useKnowledgeGraphStore((s) => s.setDetailNodeId)
  const toggleSelected = useKnowledgeGraphStore((s) => s.toggleSelected)
  const setEnriching = useKnowledgeGraphStore((s) => s.setEnriching)
  const setEnrichProgress = useKnowledgeGraphStore((s) => s.setEnrichProgress)

  const canvasHandleRef = useRef<GraphCanvasHandle | null>(null)

  // 首次加载 + 订阅 AI 增强进度
  useEffect(() => {
    loadGraph()
    const unsubscribe = window.aeromind.kb.onGraphEnrichProgress((p) => {
      setEnrichProgress(p)
    })
    return unsubscribe
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 过滤派生：产出"隐藏 id 集合"而非"可见数组"。
  // 关键：graph.nodes/graph.edges 保持 store 里的稳定引用传给画布，过滤只算哪些元素该隐藏，
  // 由 GraphCanvas 用 class 显隐切换——不 remove/add、不 relayout，拖阈值滑块全程丝滑。
  const { hiddenNodeIds, hiddenEdgeIds } = useMemo(() => {
    const hiddenNodes = new Set<string>()
    const hiddenEdges = new Set<string>()
    if (!graph) return { hiddenNodeIds: hiddenNodes, hiddenEdgeIds: hiddenEdges }

    const hasCatFilter = filters.categories.length > 0
    const hasTagFilter = filters.tags.length > 0

    if (filters.entitiesOnly) {
      // 只看AI实体：隐藏所有"无实体连接"的文档节点
      const docIdsWithEntity = new Set<string>()
      for (const e of graph.edges) {
        if (e.kind === 'mentions') docIdsWithEntity.add(e.target)
      }
      for (const n of graph.nodes) {
        if (n.kind === 'document' && !docIdsWithEntity.has(n.id)) hiddenNodes.add(n.id)
      }
    } else if (hasCatFilter || hasTagFilter) {
      for (const n of graph.nodes) {
        if (n.kind === 'entity') continue // 实体节点靠 mentions 边连着可见文档，先保留
        const catOk = !hasCatFilter || filters.categories.includes(n.category || '未分类')
        const tagOk = !hasTagFilter || (n.tags || []).some((t) => filters.tags.includes(t))
        if (!catOk || !tagOk) hiddenNodes.add(n.id)
      }
    }

    // 边隐藏：相似边低于阈值；或任一端点被隐藏
    for (const e of graph.edges) {
      if (e.kind === 'similar' && (e.weight ?? 0) < filters.threshold) {
        hiddenEdges.add(e.id)
        continue
      }
      if (hiddenNodes.has(e.source) || hiddenNodes.has(e.target)) {
        hiddenEdges.add(e.id)
      }
    }

    // 级联：隐藏节点导致的孤立实体节点也隐藏（仅分类/标签过滤时）
    if (!filters.entitiesOnly && (hasCatFilter || hasTagFilter)) {
      for (const n of graph.nodes) {
        if (n.kind !== 'entity' || hiddenNodes.has(n.id)) continue
        const hasVisibleEdge = graph.edges.some(
          (e) => !hiddenEdges.has(e.id) && (e.source === n.id || e.target === n.id)
        )
        if (!hasVisibleEdge) hiddenNodes.add(n.id)
      }
    }

    return { hiddenNodeIds: hiddenNodes, hiddenEdgeIds: hiddenEdges }
  }, [graph, filters])

  const handleNodeClick = useCallback((node: GraphNode) => {
    setDetailNodeId(node.id)
  }, [setDetailNodeId])

  const handleToggleSelect = useCallback((nodeId: string) => {
    toggleSelected(nodeId)
  }, [toggleSelected])

  const handleBackgroundClick = useCallback(() => {
    setDetailNodeId(null)
  }, [setDetailNodeId])

  const handleCanvasReady = useCallback((handle: GraphCanvasHandle) => {
    canvasHandleRef.current = handle
  }, [])

  const handleExportPng = useCallback(() => {
    const dataUrl = canvasHandleRef.current?.exportPng()
    if (!dataUrl) {
      message.error('导出失败')
      return
    }
    const link = document.createElement('a')
    link.href = dataUrl
    link.download = `知识图谱-${new Date().toISOString().slice(0, 10)}.png`
    link.click()
  }, [])

  const runEnrich = useCallback(async (docIds: string[]) => {
    if (docIds.length === 0) {
      message.info('请先选择要增强的文档节点')
      return
    }
    setEnriching(true)
    setEnrichProgress(null)
    try {
      const summary = await window.aeromind.kb.graphLlmEnrich(docIds)
      const parts: string[] = []
      if (summary.done > 0) parts.push(`新抽取 ${summary.done} 个文档`)
      if (summary.skipped > 0) parts.push(`${summary.skipped} 个已是最新`)
      if (summary.failed > 0) parts.push(`${summary.failed} 个失败`)
      message.success(`AI增强完成：${parts.join('，')}（共 ${summary.entityCount} 个实体）`)
      await loadGraph()
    } catch (err) {
      message.error(`AI增强失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setEnriching(false)
      setEnrichProgress(null)
    }
  }, [loadGraph, setEnriching, setEnrichProgress])

  const handleEnrichSelected = useCallback(() => {
    runEnrich(selectedDocIds(graph, selectedIds))
  }, [runEnrich, graph, selectedIds])

  const handleEnrichDoc = useCallback((docId: string) => {
    runEnrich([docId])
  }, [runEnrich])

  const handleClearEnrichment = useCallback(async () => {
    await window.aeromind.kb.graphClearEnrichment()
    message.success('已清除 AI 增强层')
    await loadGraph()
  }, [loadGraph])

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-96">
        <Empty description={`图谱加载失败: ${error}`} />
        <Button type="primary" onClick={() => loadGraph()} className="mt-4">重试</Button>
      </div>
    )
  }

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 180px)' }}>
      {/* 工具条 */}
      <div className="mb-3">
        <GraphToolbar
          onRelayout={() => canvasHandleRef.current?.relayout()}
          onExportPng={handleExportPng}
          onEnrichSelected={handleEnrichSelected}
          onClearEnrichment={handleClearEnrichment}
        />
      </div>

      {/* 主体：过滤面板 + 画布 */}
      <div className="flex-1 flex min-h-0 bg-white rounded-card border border-line-light shadow-card overflow-hidden">
        <div className="p-3 overflow-y-auto">
          <GraphFilterPanel />
        </div>
        <div className="flex-1 relative min-w-0">
          {loading && !graph ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
              <Spin size="large" />
              <span className="text-sm text-gray-500">正在计算文档相似度…</span>
            </div>
          ) : !graph || graph.nodes.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Empty
                image={<ApartmentOutlined style={{ fontSize: 48, color: '#d9d9d9' }} />}
                description={
                  <span className="text-gray-500">
                    暂无可视化内容<br />
                    <span className="text-xs text-gray-400">请先在"知识库"标签页导入文档</span>
                  </span>
                }
              />
            </div>
          ) : (
            <GraphCanvas
              nodes={graph.nodes}
              edges={graph.edges}
              hiddenNodeIds={hiddenNodeIds}
              hiddenEdgeIds={hiddenEdgeIds}
              selectedIds={selectedIds}
              searchTerm={searchTerm}
              onReady={handleCanvasReady}
              onNodeClick={handleNodeClick}
              onToggleSelect={handleToggleSelect}
              onBackgroundClick={handleBackgroundClick}
            />
          )}
          {graph?.truncated && (
            <div className="absolute top-2 right-2 text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded px-2 py-0.5">
              文档较多，已自动降低采样精度
            </div>
          )}
        </div>
      </div>

      {/* 问答面板 */}
      <GraphAskPanel />

      {/* 节点详情抽屉 */}
      <NodeDetailDrawer onEnrichDoc={handleEnrichDoc} />
    </div>
  )
}
