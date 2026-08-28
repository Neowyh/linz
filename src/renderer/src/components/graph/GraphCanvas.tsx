import { useEffect, useRef, useCallback } from 'react'
import cytoscape from 'cytoscape'
import type { Core, EventObject } from 'cytoscape'
import type { GraphNode, GraphEdge } from '../../types/knowledgeGraph'

// 分类配色：与 KnowledgePage CATEGORY_COLORS / theme.css 品牌色一致
const CATEGORY_COLORS: Record<string, string> = {
  '气动分析': '#1E6FCC',
  '结构强度': '#FA8C16',
  '推进设计': '#CF1322',
  '航电控制': '#08979C',
  '总体设计': '#722ED1',
  '标准规范': '#2F54EB',
  '未分类': '#8C8C8C'
}
const DEFAULT_DOC_COLOR = '#1E6FCC'
const ENTITY_COLOR = '#595959'

// 兜底调色板（分类表之外的新分类自动分配，复用 plot-chart 的 PALETTE）
const FALLBACK_PALETTE = ['#389E0D', '#D48806', '#531DAB', '#C41D7F', '#13C2C2', '#FA541C']
const assignedColors = new Map<string, string>()
function colorForCategory(category?: string): string {
  if (!category) return DEFAULT_DOC_COLOR
  if (CATEGORY_COLORS[category]) return CATEGORY_COLORS[category]
  let color = assignedColors.get(category)
  if (!color) {
    color = FALLBACK_PALETTE[assignedColors.size % FALLBACK_PALETTE.length]
    assignedColors.set(category, color)
  }
  return color
}

export interface GraphCanvasHandle {
  relayout: () => void
  exportPng: () => string | null
  fit: () => void
}

interface GraphCanvasProps {
  nodes: GraphNode[]
  edges: GraphEdge[]
  // 过滤命中的元素 id（显隐切换用，不触发重排）
  hiddenNodeIds: Set<string>
  hiddenEdgeIds: Set<string>
  selectedIds: string[]
  searchTerm: string
  onReady: (handle: GraphCanvasHandle) => void
  onNodeClick: (node: GraphNode) => void
  onToggleSelect: (nodeId: string) => void
  onBackgroundClick: () => void
}

export default function GraphCanvas({
  nodes,
  edges,
  hiddenNodeIds,
  hiddenEdgeIds,
  selectedIds,
  searchTerm,
  onReady,
  onNodeClick,
  onToggleSelect,
  onBackgroundClick
}: GraphCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  // 用 ref 持有最新回调，避免 cytoscape 事件监听反复解绑/重绑
  const callbacksRef = useRef({ onNodeClick, onToggleSelect, onBackgroundClick, onReady })
  callbacksRef.current = { onNodeClick, onToggleSelect, onBackgroundClick, onReady }

  const runLayout = useCallback((): void => {
    const cy = cyRef.current
    if (!cy) return
    cy.layout({
      name: 'cose',
      // 桌面端关闭动画，避免老 Win7 机器掉帧
      animate: false,
      idealEdgeLength: 120,
      nodeRepulsion: 8000,
      edgeElasticity: 100,
      gravity: 80,
      numIter: 1000,
      randomize: true
    } as cytoscape.LayoutOptions).run()
  }, [])

  // 初始化（仅一次）
  useEffect(() => {
    if (!containerRef.current) return
    const cy = cytoscape({
      container: containerRef.current,
      wheelSensitivity: 0.2,
      minZoom: 0.2,
      maxZoom: 3,
      style: [
        {
          selector: 'node',
          style: {
            'label': 'data(label)',
            'font-size': 11,
            'color': '#333',
            'text-valign': 'bottom',
            'text-margin-y': 4,
            'text-max-width': '120px',
            'text-wrap': 'ellipsis',
            'background-color': '#1E6FCC',
            'width': 28,
            'height': 28,
            'border-width': 2,
            'border-color': '#fff',
            'overlay-padding': 6
          }
        },
        {
          // 文档节点按分类着色，大小随 chunk 数略增
          selector: 'node[kind="document"]',
          style: {
            'background-color': (ele: cytoscape.NodeSingular) => colorForCategory(ele.data('category')),
            'width': (ele: cytoscape.NodeSingular) => 24 + Math.min(16, (ele.data('chunkCount') || 0) / 4),
            'height': (ele: cytoscape.NodeSingular) => 24 + Math.min(16, (ele.data('chunkCount') || 0) / 4)
          } as cytoscape.Css.Node
        },
        {
          // 实体节点：菱形、灰色系、略小
          selector: 'node[kind="entity"]',
          style: {
            'shape': 'diamond',
            'background-color': ENTITY_COLOR,
            'width': 20,
            'height': 20,
            'font-size': 10
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#C9CDD4',
            'curve-style': 'bezier',
            'opacity': 0.7
          }
        },
        {
          // 相似边：粗细随权重
          selector: 'edge[kind="similar"]',
          style: {
            'width': (ele: cytoscape.EdgeSingular) => 1 + (ele.data('weight') || 0) * 4,
            'line-color': '#91C4F2'
          } as cytoscape.Css.Edge
        },
        {
          // 关系边：带标签、虚线
          selector: 'edge[kind="relation"]',
          style: {
            'line-style': 'dashed',
            'line-color': '#B7B7B7',
            'label': 'data(label)',
            'font-size': 9,
            'color': '#888',
            'text-rotation': 'autorotate',
            'text-background-color': '#fff',
            'text-background-opacity': 0.8,
            'text-background-padding': '2px'
          }
        },
        {
          // mentions 边（实体→来源文档）：细灰、无标签
          selector: 'edge[kind="mentions"]',
          style: {
            'width': 1,
            'line-color': '#E0E0E0',
            'opacity': 0.5
          }
        },
        {
          selector: 'node.selected',
          style: {
            'border-color': '#1E6FCC',
            'border-width': 4,
            'overlay-color': '#1E6FCC',
            'overlay-opacity': 0.15
          }
        },
        {
          selector: '.highlight',
          style: {
            'opacity': 1,
            'line-color': '#1E6FCC',
            'border-color': '#1E6FCC',
            'border-width': 3,
            'z-index': 10
          }
        },
        {
          selector: '.dimmed',
          style: {
            'opacity': 0.15
          }
        },
        {
          // 过滤命中：整体隐藏（显隐切换，不触发重排）
          selector: '.filtered',
          style: {
            'display': 'none'
          }
        }
      ]
    })

    cy.on('tap', 'node', (evt: EventObject) => {
      const data = evt.target.data() as GraphNode
      const original = evt.originalEvent as MouseEvent | undefined
      // ctrl/cmd + 点击 = 多选（对话联动）；普通点击 = 看详情
      if (original && (original.ctrlKey || original.metaKey)) {
        callbacksRef.current.onToggleSelect(data.id)
      } else {
        callbacksRef.current.onNodeClick(data)
      }
    })

    cy.on('tap', (evt: EventObject) => {
      if (evt.target === cy) callbacksRef.current.onBackgroundClick()
    })

    // hover 高亮邻居
    cy.on('mouseover', 'node', (evt: EventObject) => {
      const neighborhood = evt.target.neighborhood().add(evt.target)
      cy.elements().not(neighborhood).addClass('dimmed')
      neighborhood.addClass('highlight')
    })
    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('dimmed highlight')
    })

    cyRef.current = cy

    // 把命令式句柄交给父组件（重排/导出/适应视野）
    callbacksRef.current.onReady({
      relayout: () => runLayout(),
      exportPng: () => {
        try {
          return cy.png({ full: true, scale: 2, bg: '#ffffff' })
        } catch {
          return null
        }
      },
      fit: () => cy.fit(undefined, 40)
    })

    return () => {
      cy.destroy()
      cyRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 结构 effect：仅当图数据真正变化（初次加载/AI增强/清除/切库，store 中 graph 引用改变）时
  // 才整体替换元素并重排。过滤不走这里——nodes/edges 是 store 的稳定引用，滑块拖动不会触发本 effect。
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return

    const elements: cytoscape.ElementDefinition[] = [
      ...nodes.map((n) => ({
        data: { ...n, id: n.id } as Record<string, unknown>,
        classes: n.kind
      })),
      ...edges.map((e) => ({
        data: { id: e.id, source: e.source, target: e.target, kind: e.kind, weight: e.weight, label: e.label || '' }
      }))
    ]

    cy.elements().remove()
    if (elements.length > 0) {
      cy.add(elements)
      runLayout()
    }
  }, [nodes, edges, runLayout])

  // 显隐 effect：过滤（阈值/分类/标签/只看实体）只做 class 显隐切换，绝不 relayout。
  // cy.batch 原子提交，display:none 是 cytoscape 最廉价的更新——拖阈值滑块全程丝滑、节点不动。
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.batch(() => {
      cy.elements().removeClass('filtered')
      hiddenNodeIds.forEach((id) => {
        const el = cy.getElementById(id)
        if (el.nonempty()) el.addClass('filtered')
      })
      hiddenEdgeIds.forEach((id) => {
        const el = cy.getElementById(id)
        if (el.nonempty()) el.addClass('filtered')
      })
    })
  }, [hiddenNodeIds, hiddenEdgeIds, nodes, edges])

  // 选中态同步
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().removeClass('selected')
    for (const id of selectedIds) {
      const node = cy.getElementById(id)
      if (node.nonempty()) node.addClass('selected')
    }
  }, [selectedIds, nodes])

  // 搜索定位：命中节点居中 + 邻居高亮
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().removeClass('dimmed highlight')
    const term = searchTerm.trim().toLowerCase()
    if (!term) return
    const hits = cy.nodes().filter((n) => String(n.data('label') || '').toLowerCase().includes(term))
    if (hits.length === 0) return
    const neighborhood = hits.neighborhood().add(hits)
    cy.elements().not(neighborhood).addClass('dimmed')
    neighborhood.addClass('highlight')
    cy.animate({ center: { eles: hits }, zoom: Math.max(cy.zoom(), 1) }, { duration: 300 })
  }, [searchTerm])

  return (
    <div
      ref={containerRef}
      className="w-full h-full bg-white"
      style={{ minHeight: 400 }}
    />
  )
}
