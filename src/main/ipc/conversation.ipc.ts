import { ipcMain } from 'electron'
import { getConversationsRepo, getMessagesRepo } from '../database'
import { v4 as uuidv4 } from 'uuid'

export function registerConversationIPC(): void {
  ipcMain.handle('conversation:list', async () => {
    const repo = getConversationsRepo()
    return repo.list()
  })

  ipcMain.handle('conversation:get', async (_event, id: string) => {
    const convRepo = getConversationsRepo()
    const msgRepo = getMessagesRepo()
    const conversation = convRepo.getById(id)
    if (!conversation) return null
    const messages = msgRepo.listByConversation(id)
    return { ...conversation, messages }
  })

  ipcMain.handle('conversation:create', async (_event, title?: string) => {
    const repo = getConversationsRepo()
    const id = uuidv4()
    return repo.create(id, title)
  })

  ipcMain.handle('conversation:delete', async (_event, id: string) => {
    const repo = getConversationsRepo()
    repo.delete(id)
    return { success: true }
  })

  ipcMain.handle('conversation:rename', async (_event, id: string, title: string) => {
    const repo = getConversationsRepo()
    repo.updateTitle(id, title)
    return { success: true }
  })
}
