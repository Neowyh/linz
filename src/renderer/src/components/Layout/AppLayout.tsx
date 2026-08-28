import { DoubleRightOutlined } from '@ant-design/icons'
import Sidebar from './Sidebar'
import SettingsModal from './SettingsModal'
import DockWorkspace from '../../dock/DockWorkspace'
import MenuActionHandler from './MenuActionHandler'
import { useStreaming } from '../../hooks/useStreaming'
import { useUIStore } from '../../stores/uiStore'

export default function AppLayout(): JSX.Element {
  // 全局注册流式监听
  useStreaming()
  const leftPanelOpen = useUIStore((s) => s.leftPanelOpen)
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel)

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      {leftPanelOpen ? (
        <Sidebar />
      ) : (
        // 侧边栏隐藏时留一条恢复栏，否则鼠标用户无法找回
        <div className="w-5 flex-shrink-0 border-r border-line bg-white flex items-start justify-center pt-4">
          <button
            onClick={toggleLeftPanel}
            className="p-0.5 text-gray-400 hover:text-primary hover:bg-gray-100 rounded transition-colors"
            title="显示侧边栏"
            aria-label="显示侧边栏"
          >
            <DoubleRightOutlined style={{ fontSize: 12 }} />
          </button>
        </div>
      )}
      <DockWorkspace />
      <SettingsModal />
      {/* 应用菜单动作分发（文件/编辑/视图/导航菜单） */}
      <MenuActionHandler />
    </div>
  )
}
