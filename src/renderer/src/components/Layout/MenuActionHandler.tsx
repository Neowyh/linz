import { useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useConversationStore } from '../../stores/conversationStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import { useChatStore } from '../../stores/chatStore'
import { useDockStore } from '../../dock/dockStore'
import type { PanelTypeId } from '../../dock/types'
import { exportConversationByMenu } from '../../utils/exportChat'

export type MenuAction =
  | 'new-conversation'
  | 'close-conversation'
  | 'export-markdown'
  | 'export-word'
  | 'export-pdf'
  | 'search-focus'
  | 'theme'
  | 'right-panel-toggle'
  | 'left-panel-toggle'
  | 'right-panel-tab'
  | 'open-panel'
  | 'navigate'

// 监听主进程应用菜单（文件/编辑/视图/导航/帮助）发送的动作并分发到对应功能。
// 挂在 AppLayout 内（Router 上下文内），随应用常驻。
export default function MenuActionHandler(): null {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    return window.aeromind.menu.onAction((data) => {
      const action = data.action as MenuAction
      const payload = data.payload

      switch (action) {
        case 'new-conversation': {
          // 若已在新对话页且无消息，则不重复创建
          if (location.pathname === '/chat' || location.pathname === '/') {
            const hasMessages = useChatStore.getState().messages.length > 0
            if (!hasMessages) {
              navigate('/chat')
              return
            }
          }
          void useConversationStore.getState().createConversation().then((id) => {
            navigate(`/chat/${id}`)
          })
          break
        }
        case 'close-conversation':
          navigate('/chat')
          break
        case 'export-markdown':
          void exportConversationByMenu(useChatStore.getState().messages, 'markdown')
          break
        case 'export-word':
          void exportConversationByMenu(useChatStore.getState().messages, 'word')
          break
        case 'export-pdf':
          void exportConversationByMenu(useChatStore.getState().messages, 'pdf')
          break
        case 'search-focus':
          window.dispatchEvent(new CustomEvent('menu:focus-search'))
          break
        case 'theme': {
          const theme = payload as 'light' | 'dark' | 'system'
          if (theme === 'light' || theme === 'dark' || theme === 'system') {
            void useSettingsStore.getState().setTheme(theme)
          }
          break
        }
        case 'right-panel-toggle':
          useUIStore.getState().toggleCompanionPanes()
          break
        case 'left-panel-toggle':
          useUIStore.getState().toggleLeftPanel()
          break
        case 'right-panel-tab': {
          const tab = payload as 'browser' | 'terminal' | 'files'
          if (tab === 'browser' || tab === 'terminal' || tab === 'files') {
            useUIStore.getState().setCompanionPanesVisible(true)
            useDockStore.getState().openPanelType(tab)
          }
          break
        }
        case 'open-panel': {
          const type = payload as PanelTypeId
          if (type) {
            useUIStore.getState().setCompanionPanesVisible(true)
            useDockStore.getState().openPanelType(type)
          }
          break
        }
        case 'navigate': {
          const path = payload as string
          if (typeof path === 'string' && path.startsWith('/')) {
            navigate(path)
          }
          break
        }
      }
    })
  }, [navigate, location.pathname])

  return null
}
