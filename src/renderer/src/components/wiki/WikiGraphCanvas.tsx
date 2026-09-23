import { useEffect, useRef } from 'react'
import cytoscape from 'cytoscape'
import type { Core, EventObject } from 'cytoscape'
import type { WikiGraphData } from '../../types/wiki'

// 页面类型配色
const PAGE_TYPE_COLORS: Record<string, string> = {
  entity: '#1E6FCC',
  concept: '#722ED1',
  summary: '#08979C',
  index: '#FA8C16',
  synthesis: '#CF1322',
  comparison: '#389E0D'
}
const DEFAULT_COLOR = '#595959'

interface WikiGraphCanvasProps {
  data: WikiGraphData | null
  selectedSlug: string | null
  onNodeClick: (slug: string) => void
}

export default function WikiGraphCanvas({ data, selectedSlug, onNodeClick }: WikiGraphCanvasProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const cyRef = useRef<Core | null>(null)
  const clickRef = useRef(onNodeClick)
  clickRef.current = onNodeClick

  // 初始化
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
            'text-max-width': '100px',
            'text-wrap': 'ellipsis',
            'background-color': DEFAULT_COLOR,
            'width': 28,
            'height': 28,
            'border-width': 2,
            'border-color': '#fff',
            'overlay-padding': 6
          }
        },
        {
          selector: 'edge',
          style: {
            'width': 1.5,
            'line-color': '#C9CDD4',
            'curve-style': 'bezier',
            'opacity': 0.6,
            'target-arrow-shape': 'triangle',
            'arrow-scale': 0.8
          }
        },
        {
          selector: 'node.selected',
          style: {
            'border-color': '#1E6FCC',
            'border-width': 4
          }
        },
        {
          selector: '.highlight',
          style: { 'opacity': 1, 'border-color': '#1E6FCC', 'border-width': 3, 'z-index': 10 }
        },
        {
          selector: '.dimmed',
          style: { 'opacity': 0.15 }
        }
      ]
    })

    cy.on('tap', 'node', (evt: EventObject) => {
      const slug = evt.target.data('id') as string
      clickRef.current(slug)
    })

    cy.on('mouseover', 'node', (evt: EventObject) => {
      const neighborhood = evt.target.neighborhood().add(evt.target)
      cy.elements().not(neighborhood).addClass('dimmed')
      neighborhood.addClass('highlight')
    })
    cy.on('mouseout', 'node', () => {
      cy.elements().removeClass('dimmed highlight')
    })

    cyRef.current = cy
    return () => { cy.destroy(); cyRef.current = null }
  }, [])

  // 数据更新
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.elements().remove()
    if (!data || data.nodes.length === 0) return

    const elements: cytoscape.ElementDefinition[] = [
      ...data.nodes.map((n) => ({
        data: {
          id: n.slug,
          label: n.title,
          pageType: n.pageType,
          linkCount: n.linkCount
        }
      })),
      ...data.edges.map((e) => ({
        data: { id: `${e.source}-${e.target}`, source: e.source, target: e.target }
      }))
    ]

    cy.add(elements)

    // 按页面类型着色 + 按链接数缩放
    cy.nodes().forEach((node) => {
      const pt = node.data('pageType') as string
      const lc = (node.data('linkCount') as number) || 0
      node.style('background-color', PAGE_TYPE_COLORS[pt] || DEFAULT_COLOR)
      const size = 20 + Math.min(20, lc * 3)
      node.style('width', size)
      node.style('height', size)
    })

    cy.layout({
      name: 'cose',
      animate: false,
      idealEdgeLength: 100,
      nodeRepulsion: 6000,
      gravity: 80,
      numIter: 800,
      randomize: true
    } as cytoscape.LayoutOptions).run()
  }, [data])

  // 选中态
  useEffect(() => {
    const cy = cyRef.current
    if (!cy) return
    cy.nodes().removeClass('selected')
    if (selectedSlug) {
      const node = cy.getElementById(selectedSlug)
      if (node.nonempty()) node.addClass('selected')
    }
  }, [selectedSlug, data])

  return <div ref={containerRef} className="w-full h-full bg-white" style={{ minHeight: 300 }} />
}
