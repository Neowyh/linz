import { BrowserWindow } from 'electron'
import { registerChatIPC } from './chat.ipc'
import { registerConversationIPC } from './conversation.ipc'
import { registerSettingsIPC } from './settings.ipc'
import { registerAgentIPC } from './agent.ipc'
import { registerAutoTasksIPC } from './autoTasks.ipc'
import { registerTemplatesIPC } from './templates.ipc'
import { registerKnowledgeIPC } from './knowledge.ipc'
import { registerTablesIPC } from './tables.ipc'
import { registerExportIPC } from './export.ipc'
import { registerOllamaIPC } from './ollama.ipc'
import { registerWorkspaceIPC } from './workspace.ipc'
import { registerCustomAgentsIPC } from './customAgents.ipc'
import { registerMcpIPC } from './mcp.ipc'
import { registerTerminalIPC } from './terminal.ipc'
import { registerAgentSkillsIPC } from './agent-skills.ipc'
import { registerFileWorkspaceIPC } from './file-workspace.ipc'

export function registerAllIPC(mainWindow: BrowserWindow): void {
  registerChatIPC(mainWindow)
  registerConversationIPC()
  registerSettingsIPC()
  registerAgentIPC()
  registerAutoTasksIPC(mainWindow)
  registerTemplatesIPC(mainWindow)
  registerKnowledgeIPC(mainWindow)
  registerTablesIPC(mainWindow)
  registerExportIPC(mainWindow)
  registerOllamaIPC()
  registerWorkspaceIPC(mainWindow)
  registerCustomAgentsIPC(mainWindow)
  registerMcpIPC()
  registerTerminalIPC(mainWindow)
  registerAgentSkillsIPC(mainWindow)
  registerFileWorkspaceIPC(mainWindow)
}
