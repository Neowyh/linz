import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { router } from './router'
import { useAgentStore } from './stores/agentStore'
import { useCustomAgentStore } from './stores/customAgentStore'
import { useDockStore, collectPanes } from './dock/dockStore'
import { useUIStore } from './stores/uiStore'
import { buildDefaultLayout, ensureAnchorPane } from './dock/defaultLayout'
import { loadLayout, saveLayout } from './dock/persistence'

function App(): JSX.Element {
  // 启动时预加载 agent 列表（含自定义 agent），
  // 供 AgentBadge 等组件解析自定义 agent 的显示名称
  useEffect(() => {
    void useAgentStore.getState().loadAgents()
    void useCustomAgentStore.getState().fetchAgents()
    const layout = ensureAnchorPane(loadLayout() ?? buildDefaultLayout())
    useDockStore.getState().hydrate(layout)
    // 启动校验：持久化布局仅剩锚点时，右侧面板显示状态应与之一致（避免开关点亮却无窗格可展示）
    const panes = collectPanes(layout)
    if (!panes.some((p) => !p.anchor) && useUIStore.getState().companionPanesVisible) {
      useUIStore.getState().setCompanionPanesVisible(false)
    }
  }, [])

  // 布局变更时持久化（仅在 layout 引用变化时写入；paneRects 等瞬态字段不触发）
  // 同时：关闭最后一个辅助窗格后自动把"显示右侧面板"开关置回隐藏态，
  // 否则开关仍显示点亮却无窗格可展示（布局里只剩锚点 → 点了没反应）。
  useEffect(() => {
    return useDockStore.subscribe((state, prev) => {
      if (state.layout !== prev.layout) {
        saveLayout(state.layout)
        const panes = collectPanes(state.layout)
        if (!panes.some((p) => !p.anchor) && useUIStore.getState().companionPanesVisible) {
          useUIStore.getState().setCompanionPanesVisible(false)
        }
      }
    })
  }, [])

  // 持久化右侧面板显示状态，重启后恢复用户选定的窗口排布
  useEffect(() => {
    return useUIStore.subscribe((state, prev) => {
      if (state.companionPanesVisible !== prev.companionPanesVisible) {
        try {
          localStorage.setItem('linz.ui.companion.visible', state.companionPanesVisible ? '1' : '0')
        } catch {
          // 忽略（localStorage 不可用）
        }
      }
    })
  }, [])

  // 主进程 browser 工具（Agent 操作侧边栏浏览器）请求打开/聚焦浏览器面板。
  // BrowserPanel 在面板关闭时未挂载，必须在这里常驻监听（逻辑同 panelCommandStore.dispatch）
  useEffect(() => {
    return window.aeromind.browser.onOpenPanel(() => {
      const ui = useUIStore.getState()
      if (!ui.companionPanesVisible) ui.setCompanionPanesVisible(true) // 内部会 restoreToolsPane()
      useDockStore.getState().openPanelType('browser')
    })
  }, [])

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1E6FCC',
          colorInfo: '#1E6FCC',
          colorBorder: '#E4E8F0',
          colorBorderSecondary: '#EEF0F5',
          colorBgLayout: '#F4F6FA',
          colorText: '#1F2329',
          colorTextSecondary: '#4E5566',
          colorTextTertiary: '#8A93A6',
          borderRadius: 8,
          controlHeight: 32,
          boxShadow: '0 6px 24px rgba(30, 50, 90, 0.12), 0 2px 8px rgba(30, 50, 90, 0.08)',
          boxShadowSecondary: '0 4px 12px rgba(30, 50, 90, 0.08), 0 2px 4px rgba(30, 50, 90, 0.06)',
          fontFamily: 'Inter, "HarmonyOS Sans SC", "思源黑体", "PingFang SC", "Microsoft YaHei", sans-serif'
        }
      }}
    >
      <RouterProvider router={router} />
    </ConfigProvider>
  )
}

export default App
