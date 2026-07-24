import { ipcMain } from 'electron'
import { agentRegistry } from '../agents/agent-registry'

export function registerAgentIPC(): void {
  ipcMain.handle('agent:listStates', async () => {
    return agentRegistry.getAllStates()
  })
}
