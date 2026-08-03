import { Outlet } from 'react-router-dom'
import Sidebar from './Sidebar'
import SettingsModal from './SettingsModal'
import RightPanel from './RightPanel'
import MenuActionHandler from './MenuActionHandler'
import { useStreaming } from '../../hooks/useStreaming'
import { useUIStore } from '../../stores/uiStore'

export default function AppLayout(): JSX.Element {
  // 全局注册流式监听
  useStreaming()
  const panelOpen = useUIStore((s) => s.rightPanelOpen)
  const fullscreen = useUIStore((s) => s.rightPanelFullscreen)
  const mainHidden = panelOpen && fullscreen

  return (
    <div className="flex h-screen w-screen overflow-hidden">
      <Sidebar />
      <main
        className={`${
          mainHidden ? 'hidden' : 'flex-1'
        } overflow-hidden bg-[#F4F6FA]`}
      >
        <Outlet />
      </main>
      <RightPanel />
      <SettingsModal />
      {/* 应用菜单动作分发（文件/编辑/视图/导航菜单） */}
      <MenuActionHandler />
    </div>
  )
}
