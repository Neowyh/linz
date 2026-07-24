import { createHashRouter } from 'react-router-dom'
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

export const router = createHashRouter([
  {
    path: '/',
    element: <AppLayout />,
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
