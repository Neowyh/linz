import { DoubleRightOutlined } from '@ant-design/icons'
import Sidebar from './Sidebar'
import SettingsModal from './SettingsModal'
import DockWorkspace from '../../dock/DockWorkspace'
import MenuActionHandler from './MenuActionHandler'
import { useStreaming } from '../../hooks/useStreaming'
import { useUIStore } from '../../stores/uiStore'
import { useSettingsStore, type BackgroundFit } from '../../stores/settingsStore'

// 填充模式 → CSS 背景属性
function bgLayerProps(dataUrl: string, fit: BackgroundFit): React.CSSProperties {
  const base: React.CSSProperties = {
    backgroundImage: `url("${dataUrl}")`,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  }
  if (fit === 'cover') base.backgroundSize = 'cover'
  else if (fit === 'contain') base.backgroundSize = 'contain'
  else if (fit === 'center') base.backgroundSize = 'auto'
  else if (fit === 'repeat') {
    base.backgroundSize = 'auto'
    base.backgroundRepeat = 'repeat'
  }
  return base
}

export default function AppLayout(): JSX.Element {
  // 全局注册流式监听
  useStreaming()
  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen)
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel)
  const backgroundDataUrl = useSettingsStore((s) => s.backgroundDataUrl)
  const backgroundFit = useSettingsStore((s) => s.backgroundFit)
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity)

  const hasBg = !!backgroundDataUrl

  // 背景激活时，侧边栏/工作区底色由不透明改为半透明，让背景图透过内容间隙可见
  // 未激活时不设置变量，回落到 globals.css :root 中的不透明默认值（零视觉变化）
  const rootStyle = hasBg
    ? ({
        '--content-bg': `rgba(244, 246, 250, ${backgroundOpacity})`,
        '--sidebar-bg': `rgba(255, 255, 255, ${backgroundOpacity})`,
        '--pane-bg': 'transparent'
      } as React.CSSProperties)
    : undefined

  const SIDEBAR_WIDTH = 260
  const RAIL_WIDTH = 20

  return (
    <div className="relative flex h-screen w-screen overflow-hidden" style={rootStyle}>
      {hasBg && (
        <div
          className="absolute inset-0 z-0"
          style={bgLayerProps(backgroundDataUrl!, backgroundFit)}
          aria-hidden="true"
        />
      )}
      <div className="relative z-10 flex h-full w-full overflow-hidden">
        {/* 左侧边栏：常驻挂载，容器宽度过渡 + 内容平移实现滑动收起/展开 */}
        <div
          className="relative flex-shrink-0 h-full overflow-hidden border-r border-line"
          style={{
            width: leftPanelOpen ? SIDEBAR_WIDTH : RAIL_WIDTH,
            background: 'var(--sidebar-bg, #FFFFFF)',
            transition: 'width 0.2s ease-in-out'
          }}
        >
          {/* Sidebar 内容 — 固定宽度，收起时向左平移出视口 */}
          <div
            className="absolute top-0 left-0 h-full"
            style={{
              width: SIDEBAR_WIDTH,
              transform: leftPanelOpen ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`,
              transition: 'transform 0.2s ease-in-out'
            }}
          >
            <Sidebar />
          </div>
          {/* 收起后的恢复栏 */}
          <div
            className={`absolute top-0 right-0 h-full w-5 flex items-start justify-center pt-4 transition-opacity duration-200 ${
              leftPanelOpen ? 'opacity-0 pointer-events-none' : 'opacity-100'
            }`}
          >
            <button
              onClick={toggleLeftPanel}
              className="p-0.5 text-gray-400 hover:text-primary hover:bg-gray-100 rounded transition-colors"
              title="显示侧边栏"
              aria-label="显示侧边栏"
            >
              <DoubleRightOutlined style={{ fontSize: 12 }} />
            </button>
          </div>
        </div>
        <DockWorkspace />
      </div>
      <SettingsModal />
      {/* 应用菜单动作分发（文件/编辑/视图/导航菜单） */}
      <MenuActionHandler />
    </div>
  )
}
