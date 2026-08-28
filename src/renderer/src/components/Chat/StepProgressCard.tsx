import { useEffect, useRef, useState, useCallback } from 'react'
import { CheckCircleFilled, LoadingOutlined, CloseOutlined, ProfileOutlined, DragOutlined } from '@ant-design/icons'
import { useStepProgressStore } from '../../stores/stepProgressStore'

// 卡片位置持久化键：拖拽后记住位置，下次还在那里
const POS_KEY = 'linz.ui.stepCard.pos'

interface CardPos {
  left: number
  top: number
}

// 默认：右上角，位于布局按钮正下方
const DEFAULT_POS: CardPos = { left: -1, top: 48 } // left<0 表示用 right 对齐（首次/复位时）

function loadPos(): CardPos {
  try {
    const raw = localStorage.getItem(POS_KEY)
    if (!raw) return { ...DEFAULT_POS }
    const p = JSON.parse(raw)
    if (typeof p.left === 'number' && typeof p.top === 'number') return p
  } catch {
    // 忽略
  }
  return { ...DEFAULT_POS }
}

function savePos(p: CardPos): void {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p))
  } catch {
    // 忽略
  }
}

/**
 * 悬浮任务进度卡片：模型响应时列出当前任务需要完成的步骤，每完成一步自动打勾。
 *
 * 定位为聊天区域**右上角的固定悬浮卡**，不挤占消息气泡空间、不随消息流滚动。
 * 拖拽头部可移动位置（会记住）；双击头部复位到右上角默认位置。
 */
export default function StepProgressCard(): JSX.Element | null {
  const steps = useStepProgressStore((s) => s.steps)
  const active = useStepProgressStore((s) => s.active)
  const endTask = useStepProgressStore((s) => s.endTask)

  const [pos, setPos] = useState<CardPos>(() => loadPos())
  const cardRef = useRef<HTMLDivElement | null>(null)
  const dragState = useRef<{ startX: number; startY: number; originLeft: number; originTop: number; dragging: boolean }>({
    startX: 0,
    startY: 0,
    originLeft: 0,
    originTop: 0,
    dragging: false
  })
  const [dragging, setDragging] = useState(false)

  const onHeaderMouseDown = useCallback(
    (e: React.MouseEvent): void => {
      // 仅左键触发拖拽；点到关闭按钮等不拖
      if (e.button !== 0) return
      const card = cardRef.current
      if (!card) return

      const rect = card.getBoundingClientRect()
      const parent = card.offsetParent as HTMLElement | null
      const parentRect = parent ? parent.getBoundingClientRect() : rect

      // 当前相对父容器的 left/top；若之前是 right 对齐(left<0)，按当前实际位置转成 left
      const currentLeft = pos.left >= 0 ? pos.left : rect.left - parentRect.left
      const currentTop = pos.top

      dragState.current = {
        startX: e.clientX,
        startY: e.clientY,
        originLeft: currentLeft,
        originTop: currentTop,
        dragging: true
      }
      setDragging(true)
      e.preventDefault()
    },
    [pos]
  )

  useEffect(() => {
    if (!dragging) return

    const onMove = (ev: MouseEvent): void => {
      const ds = dragState.current
      if (!ds.dragging) return
      const card = cardRef.current
      if (!card) return
      const parent = card.offsetParent as HTMLElement | null
      const maxLeft = parent ? parent.clientWidth - card.offsetWidth : 0
      const maxTop = parent ? parent.clientHeight - card.offsetHeight : 0
      let newLeft = ds.originLeft + (ev.clientX - ds.startX)
      let newTop = ds.originTop + (ev.clientY - ds.startY)
      // 边界约束：至少留 8px 可见，避免拖出可视区
      newLeft = Math.max(-card.offsetWidth + 80, Math.min(maxLeft - 8, newLeft))
      newTop = Math.max(0, Math.min(maxTop - 8, newTop))
      setPos({ left: newLeft, top: newTop })
    }
    const onUp = (): void => {
      dragState.current.dragging = false
      setDragging(false)
      setPos((p) => {
        savePos(p)
        return p
      })
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [dragging])

  // 双击头部复位到右上角默认
  const resetPos = useCallback((): void => {
    setPos({ ...DEFAULT_POS })
    savePos({ ...DEFAULT_POS })
  }, [])

  // 有步骤才显示（无 PLAN 或计划为空时隐藏）
  if (!active || steps.length === 0) return null

  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length
  const pct = Math.round((doneCount / steps.length) * 100)

  // left<0 表示用 right 对齐（默认位置），拖拽后用绝对 left/top
  const style: React.CSSProperties =
    pos.left >= 0
      ? { left: pos.left, top: pos.top }
      : { right: 16, top: pos.top }

  return (
    <div
      ref={cardRef}
      className={`absolute z-20 w-64 rounded-card border border-gray-200 bg-white shadow-popover overflow-hidden animate-[fadeIn_0.15s_ease-out] ${
        dragging ? 'shadow-card-hover' : ''
      }`}
      style={style}
    >
      <div
        onMouseDown={onHeaderMouseDown}
        onDoubleClick={resetPos}
        className={`flex items-center gap-2 px-3 py-2 border-b border-gray-100 bg-gradient-to-r from-primary/5 to-transparent select-none ${
          dragging ? 'cursor-grabbing' : 'cursor-grab'
        }`}
        title="拖拽移动；双击复位到右上角"
      >
        <DragOutlined className="text-gray-400" style={{ fontSize: 12 }} />
        <ProfileOutlined className="text-primary" />
        <span className="text-xs font-semibold text-gray-700">任务进度</span>
        <span className="ml-auto text-[10px] text-gray-400">
          {doneCount}/{steps.length}
          {!allDone && ` · ${pct}%`}
        </span>
        <button
          onClick={endTask}
          className="text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors p-0.5"
          title="关闭进度卡片"
        >
          <CloseOutlined style={{ fontSize: 10 }} />
        </button>
      </div>

      {/* 进度条 */}
      <div className="h-1 bg-gray-100">
        <div
          className={`h-full transition-all duration-500 ${allDone ? 'bg-green-500' : 'bg-primary'}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* 步骤列表 */}
      <ul className="px-2 py-1.5 space-y-0.5 max-h-[40vh] overflow-y-auto">
        {steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 px-1.5 py-1 rounded hover:bg-gray-50/60">
            {step.done ? (
              <CheckCircleFilled style={{ color: '#52c41a', fontSize: 14, marginTop: 1, flexShrink: 0 }} />
            ) : (
              <LoadingOutlined style={{ color: '#1E6FCC', fontSize: 14, marginTop: 1, flexShrink: 0 }} />
            )}
            <span className={`text-xs leading-5 ${step.done ? 'text-gray-400 line-through' : 'text-gray-700'}`}>
              {step.title}
            </span>
          </li>
        ))}
      </ul>

      <div className="px-3 py-1.5 border-t border-gray-100 bg-gray-50/60">
        <span className={`text-[10px] ${allDone ? 'text-green-600 font-medium' : 'text-gray-400'}`}>
          {allDone ? '✓ 全部步骤已完成' : '模型执行中…'}
        </span>
      </div>
    </div>
  )
}