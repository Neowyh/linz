import { useEffect, useRef, useCallback } from 'react'
import {
  CloseOutlined,
  GlobalOutlined,
  CodeOutlined,
  FullscreenOutlined,
  FullscreenExitOutlined,
  PlusOutlined
} from '@ant-design/icons'
import { useUIStore, RIGHT_PANEL_MIN_WIDTH, RIGHT_PANEL_MAX_WIDTH, type PanelInstance } from '../../stores/uiStore'
import BrowserPanel from '../RightPanel/BrowserPanel'
import TerminalPanel from '../RightPanel/TerminalPanel'

interface InstanceTabsProps {
  instances: PanelInstance[]
  activeId: string | null
  onSelect: (id: string) => void
  onClose: (id: string) => void
  onAdd: () => void
  emptyHint: string
}

function InstanceTabs(props: InstanceTabsProps): JSX.Element {
  const { instances, activeId, onSelect, onClose, onAdd, emptyHint } = props
  return (
    <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 bg-gray-50 overflow-x-auto flex-shrink-0">
      {instances.length === 0 && (
        <span className="text-xs text-gray-400 mr-1">{emptyHint}</span>
      )}
      {instances.map((inst) => {
        const active = inst.id === activeId
        return (
          <div
            key={inst.id}
            className={`group flex items-center gap-1 pl-2 pr-1 py-0.5 rounded text-xs cursor-pointer transition-colors flex-shrink-0 ${
              active
                ? 'bg-white text-primary border border-gray-200'
                : 'text-gray-600 hover:bg-gray-100 border border-transparent'
            }`}
            onClick={() => onSelect(inst.id)}
            title={inst.title}
          >
            <span className="max-w-[100px] truncate">{inst.title}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                onClose(inst.id)
              }}
              className="opacity-50 group-hover:opacity-100 hover:text-red-500 transition-opacity p-0.5"
              title="关闭"
            >
              <CloseOutlined style={{ fontSize: 10 }} />
            </button>
          </div>
        )
      })}
      <button
        onClick={onAdd}
        className="flex items-center justify-center w-6 h-6 rounded text-gray-500 hover:text-primary hover:bg-gray-100 transition-colors flex-shrink-0"
        title="新建实例"
      >
        <PlusOutlined style={{ fontSize: 12 }} />
      </button>
    </div>
  )
}

export default function RightPanel(): JSX.Element | null {
  const open = useUIStore((s) => s.rightPanelOpen)
  const activeTab = useUIStore((s) => s.rightPanelActiveTab)
  const width = useUIStore((s) => s.rightPanelWidth)
  const fullscreen = useUIStore((s) => s.rightPanelFullscreen)
  const setOpen = useUIStore((s) => s.setRightPanelOpen)
  const setActiveTab = useUIStore((s) => s.setRightPanelActiveTab)
  const setWidth = useUIStore((s) => s.setRightPanelWidth)
  const toggleFullscreen = useUIStore((s) => s.toggleFullscreen)

  const browserInstances = useUIStore((s) => s.browserInstances)
  const activeBrowserId = useUIStore((s) => s.activeBrowserId)
  const addBrowser = useUIStore((s) => s.addBrowser)
  const removeBrowser = useUIStore((s) => s.removeBrowser)
  const setActiveBrowser = useUIStore((s) => s.setActiveBrowser)

  const terminalInstances = useUIStore((s) => s.terminalInstances)
  const activeTerminalId = useUIStore((s) => s.activeTerminalId)
  const addTerminal = useUIStore((s) => s.addTerminal)
  const removeTerminal = useUIStore((s) => s.removeTerminal)
  const setActiveTerminal = useUIStore((s) => s.setActiveTerminal)

  const panelRef = useRef<HTMLDivElement>(null)
  const setPanelResizing = useUIStore((s) => s.setPanelResizing)

  const handleResizeMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (fullscreen) return
      e.preventDefault()
      e.stopPropagation()
      const startX = e.clientX
      const startWidth = width
      const panel = panelRef.current
      if (!panel) return

      setPanelResizing(true)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      const onMove = (ev: MouseEvent): void => {
        const delta = startX - ev.clientX
        const newWidth = Math.min(
          RIGHT_PANEL_MAX_WIDTH,
          Math.max(RIGHT_PANEL_MIN_WIDTH, startWidth + delta)
        )
        panel.style.width = `${newWidth}px`
        panel.style.minWidth = `${newWidth}px`
      }
      const onUp = (): void => {
        const currentWidth = parseInt(panel.style.width, 10)
        if (!Number.isNaN(currentWidth)) {
          setWidth(currentWidth)
        }
        setPanelResizing(false)
        document.removeEventListener('mousemove', onMove)
        document.removeEventListener('mouseup', onUp)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
      document.addEventListener('mousemove', onMove)
      document.addEventListener('mouseup', onUp)
    },
    [width, setWidth, fullscreen, setPanelResizing]
  )

  useEffect(() => {
    return () => {
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [])

  if (!open) {
    return <div className="w-0 min-w-0 overflow-hidden" />
  }

  const containerClass = fullscreen
    ? 'h-full bg-white border-l border-gray-200 flex flex-col flex-1 min-w-0'
    : 'h-full bg-white border-l border-gray-200 flex flex-col relative flex-shrink-0'

  const containerStyle = fullscreen ? undefined : { width, minWidth: width }

  const showBrowserTabs = activeTab === 'browser'
  const showTerminalTabs = activeTab === 'terminal'

  return (
    <div ref={panelRef} className={containerClass} style={containerStyle}>
      {!fullscreen && (
        <div
          onMouseDown={handleResizeMouseDown}
          className="absolute left-0 top-0 h-full w-1.5 -translate-x-1/2 cursor-col-resize hover:bg-primary/40 transition-colors z-30"
          title="拖拽调整宽度"
        />
      )}

      <div className="flex items-center justify-between px-2 h-10 border-b border-gray-200 bg-white flex-shrink-0">
        <div className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab('browser')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1.5 rounded transition-colors ${
              activeTab === 'browser'
                ? 'text-primary border-b-2 border-primary'
                : 'text-gray-500 hover:text-gray-700 border-b-2 border-transparent'
            }`}
          >
            <GlobalOutlined /> 浏览器
          </button>
          <button
            onClick={() => setActiveTab('terminal')}
            className={`px-3 py-1.5 text-xs flex items-center gap-1.5 rounded transition-colors ${
              activeTab === 'terminal'
                ? 'text-primary border-b-2 border-primary'
                : 'text-gray-500 hover:text-gray-700 border-b-2 border-transparent'
            }`}
          >
            <CodeOutlined /> 终端
          </button>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={toggleFullscreen}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title={fullscreen ? '退出全屏' : '全屏显示'}
          >
            {fullscreen ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
          </button>
          <button
            onClick={() => setOpen(false)}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            title="关闭侧边栏"
          >
            <CloseOutlined />
          </button>
        </div>
      </div>

      {showBrowserTabs && (
        <InstanceTabs
          instances={browserInstances}
          activeId={activeBrowserId}
          onSelect={setActiveBrowser}
          onClose={removeBrowser}
          onAdd={addBrowser}
          emptyHint="所有浏览器已关闭"
        />
      )}
      {showTerminalTabs && (
        <InstanceTabs
          instances={terminalInstances}
          activeId={activeTerminalId}
          onSelect={setActiveTerminal}
          onClose={removeTerminal}
          onAdd={addTerminal}
          emptyHint="所有终端已关闭"
        />
      )}

      <div className="flex-1 overflow-hidden relative">
        {activeTab === 'home' && (
          <div className="flex items-center justify-center h-full p-6">
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setActiveTab('browser')}
                className="w-[180px] h-[140px] rounded-card border border-gray-200 hover:border-primary hover:shadow-md cursor-pointer transition-all flex flex-col items-center justify-center gap-2 bg-white"
              >
                <GlobalOutlined className="text-3xl text-primary" />
                <div className="text-sm font-medium text-gray-800">浏览器</div>
                <div className="text-[11px] text-gray-500 text-center px-2">查阅资料与文档</div>
              </button>
              <button
                onClick={() => setActiveTab('terminal')}
                className="w-[180px] h-[140px] rounded-card border border-gray-200 hover:border-primary hover:shadow-md cursor-pointer transition-all flex flex-col items-center justify-center gap-2 bg-white"
              >
                <CodeOutlined className="text-3xl text-primary" />
                <div className="text-sm font-medium text-gray-800">终端</div>
                <div className="text-[11px] text-gray-500 text-center px-2">运行命令与脚本</div>
              </button>
            </div>
          </div>
        )}
        {showBrowserTabs &&
          browserInstances.map((inst) => (
            <div
              key={inst.id}
              className="absolute inset-0"
              style={{ display: inst.id === activeBrowserId ? 'block' : 'none' }}
            >
              <BrowserPanel key={inst.id} />
            </div>
          ))}
        {showTerminalTabs &&
          terminalInstances.map((inst) => (
            <div
              key={inst.id}
              className="absolute inset-0"
              style={{ display: inst.id === activeTerminalId ? 'block' : 'none' }}
            >
              <TerminalPanel key={inst.id} />
            </div>
          ))}
        {((showBrowserTabs && browserInstances.length === 0) ||
          (showTerminalTabs && terminalInstances.length === 0)) && (
          <div className="flex flex-col items-center justify-center h-full text-gray-400 gap-3">
            <span className="text-sm">无可用实例</span>
            <button
              onClick={() => (showBrowserTabs ? addBrowser() : addTerminal())}
              className="px-3 py-1.5 text-xs text-primary border border-primary rounded hover:bg-primary hover:text-white transition-colors flex items-center gap-1"
            >
              <PlusOutlined /> 新建{showBrowserTabs ? '浏览器' : '终端'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
