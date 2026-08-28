import { Fragment, memo, useEffect, useRef } from 'react'
import { Outlet } from 'react-router-dom'
import PaneFrame from './PaneFrame'
import InstanceHostOverlay from './InstanceHostOverlay'
import { useDockStore, isSplit } from './dockStore'
import { useUIStore } from '../stores/uiStore'
import type { DockNode, SplitNode } from './types'

function flexFor(index: number, count: number, ratio: number): React.CSSProperties {
  if (count === 1) return { flex: '1 1 0%' }
  if (index === 0) return { flex: `${ratio} 1 0%` }
  return { flex: `${(1 - ratio) / (count - 1)} 1 0%` }
}

function SplitDivider({ splitId, direction }: { splitId: string; direction: 'row' | 'col' }): JSX.Element {
  const setRatio = useDockStore((s) => s.setRatio)

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    e.preventDefault()
    e.stopPropagation()
    const el = e.currentTarget
    const container = el.parentElement
    if (!container) return
    const rect = container.getBoundingClientRect()
    const len = direction === 'row' ? rect.width : rect.height
    if (len <= 0) return
    const left = direction === 'row' ? rect.left : rect.top

    try {
      el.setPointerCapture(e.pointerId)
    } catch {
      // 忽略（某些环境不支持）
    }

    document.body.style.cursor = direction === 'row' ? 'col-resize' : 'row-resize'
    document.body.style.userSelect = 'none'

    const onMove = (ev: PointerEvent): void => {
      const pos = (direction === 'row' ? ev.clientX : ev.clientY) - left
      const nxt = pos / len
      if (!Number.isNaN(nxt)) setRatio(splitId, nxt)
    }
    const onUp = (): void => {
      try {
        el.releasePointerCapture(e.pointerId)
      } catch {
        // 忽略
      }
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
      el.removeEventListener('pointercancel', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
    el.addEventListener('pointercancel', onUp)
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className={
        direction === 'row'
          ? 'w-1 h-full cursor-col-resize hover:bg-primary/40 transition-colors flex-shrink-0 z-10'
          : 'h-1 w-full cursor-row-resize hover:bg-primary/40 transition-colors flex-shrink-0 z-10'
      }
      title="拖拽调整大小"
    />
  )
}

const Split = memo(function SplitTransform({ split }: { split: SplitNode }): JSX.Element {
  const byId = useDockStore((s) => s.layout.byId)
  const children = split.children.map((id) => byId[id]).filter(Boolean) as DockNode[]
  const direction = split.direction
  const count = children.length

  return (
    <div
      className={`flex h-full w-full min-w-0 min-h-0 overflow-hidden ${
        direction === 'row' ? 'flex-row' : 'flex-col'
      }`}
    >
      {children.map((child, i) => (
        <Fragment key={child.id}>
          {i > 0 && <SplitDivider splitId={split.id} direction={direction} />}
          <div
            className={direction === 'row' ? 'h-full min-w-0 min-h-0' : 'w-full min-w-0 min-h-0'}
            style={flexFor(i, count, split.ratio)}
          >
            <NodeRenderer node={child} />
          </div>
        </Fragment>
      ))}
    </div>
  )
})

function NodeRenderer({ node }: { node: DockNode }): JSX.Element {
  if (isSplit(node)) return <Split split={node} />
  return <PaneFrame pane={node} />
}

export default function DockWorkspace(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const root = useDockStore((s) => (s.layout.rootId ? s.layout.byId[s.layout.rootId] : null))
  const companionVisible = useUIStore((s) => s.companionPanesVisible)
  const setContainerOrigin = useDockStore((s) => s.setContainerOrigin)

  // 上报容器原点，供窗格内容盒换算相对 rect
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const report = (): void => {
      const r = el.getBoundingClientRect()
      setContainerOrigin({ x: r.left, y: r.top })
    }
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [setContainerOrigin])

  if (!root || !companionVisible) {
    return (
      <div ref={containerRef} className="flex-1 h-full min-w-0 relative overflow-hidden bg-[#F4F6FA]">
        <Outlet />
      </div>
    )
  }

  return (
    <div ref={containerRef} className="flex-1 h-full min-w-0 relative overflow-hidden bg-[#F4F6FA]">
      <NodeRenderer node={root} />
      <InstanceHostOverlay />
    </div>
  )
}
