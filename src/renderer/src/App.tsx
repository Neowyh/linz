import { useEffect } from 'react'
import { RouterProvider } from 'react-router-dom'
import { ConfigProvider } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { router } from './router'
import { useAgentStore } from './stores/agentStore'
import { useCustomAgentStore } from './stores/customAgentStore'

function App(): JSX.Element {
  // 启动时预加载 agent 列表（含自定义 agent），
  // 供 AgentBadge 等组件解析自定义 agent 的显示名称
  useEffect(() => {
    void useAgentStore.getState().loadAgents()
    void useCustomAgentStore.getState().fetchAgents()
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
