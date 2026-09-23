import { createHashRouter, useRouteError } from 'react-router-dom'
import { Button } from 'antd'
import AppLayout from '../components/Layout/AppLayout'
import ChatPage from '../pages/ChatPage'
import OfficePage from '../pages/OfficePage'
import AutoTasksPage from '../pages/AutoTasksPage'
import TemplatesPage from '../pages/TemplatesPage'
import TemplateEditorPage from '../pages/TemplateEditorPage'
import AgentsPage from '../pages/AgentsPage'
import AgentEditorPage from '../pages/AgentEditorPage'
import AgentSkillEditorPage from '../pages/AgentSkillEditorPage'
import KnowledgePage from '../pages/KnowledgePage'

// 路由级错误兜底：data router 的渲染错误（如脏数据里混入对象触发
// React "Objects are not valid as a React child" #31）会被 router 内部
// 边界捕获。不配 errorElement 时它显示不可恢复的灰屏
// "Unexpected Application Error! Minified React error #31"；这里改用可恢复页。
function RouteErrorElement() {
  const error = useRouteError() as Error | undefined
  return (
    <div className="flex flex-col items-center justify-center h-screen gap-4 p-8 text-center">
      <div className="text-lg font-medium text-gray-800">应用遇到意外错误</div>
      <div className="text-sm text-gray-500 max-w-md break-words">
        {error?.message || '渲染过程中发生未知错误。重新加载通常可以恢复。'}
      </div>
      <Button type="primary" onClick={() => window.location.reload()}>
        重新加载
      </Button>
    </div>
  )
}

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorElement />,
    children: [
      { index: true, element: <ChatPage /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'chat/:conversationId', element: <ChatPage /> },
      { path: 'office', element: <OfficePage /> },
      { path: 'auto-tasks', element: <AutoTasksPage /> },
      { path: 'templates', element: <TemplatesPage /> },
      { path: 'templates/new', element: <TemplateEditorPage /> },
      { path: 'templates/:id/edit', element: <TemplateEditorPage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'agents/new', element: <AgentEditorPage /> },
      { path: 'agents/:id/edit', element: <AgentEditorPage /> },
      { path: 'agent-skills/new', element: <AgentSkillEditorPage /> },
      { path: 'agent-skills/:id/edit', element: <AgentSkillEditorPage /> },
      { path: 'knowledge', element: <KnowledgePage /> }
    ]
  }
])
