import { ipcMain, BrowserWindow } from 'electron'
import { getAgentEngine } from '../agents'
import { getMessagesRepo, getConversationsRepo } from '../database'
import { isOverBudget, getBudgetPercentage, addTokenUsage, getAppConfig, getCurrentMonthUsage } from '../store/app-config'
import { estimateTokens } from '../llm'
import { v4 as uuidv4 } from 'uuid'
import { parseFile, formatAttachmentContent, type ParsedAttachment } from '../parsers'

let mainWindowRef: BrowserWindow | null = null
let currentAbortController: AbortController | null = null

function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) return mainWindowRef
  const wins = BrowserWindow.getAllWindows()
  return wins.length > 0 ? wins[0] : null
}

export function registerChatIPC(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  ipcMain.on('chat:sendMessage', async (_event, { conversationId, content, selectedAgent, dispatchMode }) => {
    // 中止之前的流，避免竞态
    if (currentAbortController) {
      currentAbortController.abort()
    }
    currentAbortController = new AbortController()
    const myController = currentAbortController

    const win = getMainWindow()

    try {
      // Token 预算检查（提醒模式，不拦截）
      if (isOverBudget()) {
        const percentage = Math.round(getBudgetPercentage() * 100)
        const budget = getAppConfig().get('tokenBudget')
        const usage = getCurrentMonthUsage()
        win?.webContents.send('chat:streamChunk', {
          conversationId,
          messageId: uuidv4(),
          agentType: 'system',
          chunk: `⚠️ 本月 Token 预算已用完，当前使用率：${percentage}%（已用 ${(usage.inputTokens + usage.outputTokens).toLocaleString()} / 预算 ${budget.monthlyLimit.toLocaleString()}）。如需继续，请在设置中调整预算或关闭预算控制。\n\n---\n\n`
        })
      }

      const messagesRepo = getMessagesRepo()
      const convRepo = getConversationsRepo()

      // 估算用户消息 token 数并记录
      const userTokenEstimate = estimateTokens(content)
      addTokenUsage(userTokenEstimate, 0)

      // 持久化用户消息
      const userMsgId = uuidv4()
      messagesRepo.insert({
        id: userMsgId,
        conversation_id: conversationId,
        role: 'user',
        agent_type: null,
        content,
        tokens: userTokenEstimate
      })

      // 更新对话标题（如果是第一条消息）
      const conv = convRepo.getById(conversationId)
      if (conv && conv.title === '新对话') {
        const title = content.length > 30 ? content.substring(0, 30) + '...' : content
        convRepo.updateTitle(conversationId, title)
      }

      // 获取 Agent 引擎并处理
      const engine = getAgentEngine()
      if (!engine) {
        win?.webContents.send('chat:streamError', {
          conversationId,
          error: 'Agent 引擎未初始化，请先配置 API Key'
        })
        return
      }

      const fileWorkspacePath = (getAppConfig().get('fileWorkspacePath') as string) || ''
      const stream = engine.handleUserMessage(conversationId, content, myController.signal, selectedAgent, fileWorkspacePath, dispatchMode)

      // 按 messageId 聚合流式内容，用于最终持久化
      const agentMessages = new Map<string, { agentType: string; content: string }>()

      for await (const chunk of stream) {
        if (myController.signal.aborted) break

        win?.webContents.send('chat:streamChunk', {
          conversationId,
          messageId: chunk.messageId,
          agentType: chunk.agentType,
          chunk: chunk.content,
          toolCall: chunk.toolCall,
          thinking: chunk.thinking
        })

        if (chunk.statusChange) {
          win?.webContents.send('agent:statusUpdate', chunk.statusChange)
        }

        // 转发 agent 间结构化消息到办公室可视化
        if (chunk.agentMessage) {
          win?.webContents.send('agent:message', chunk.agentMessage)
        }

        // 聚合内容（包含工具调用最终结果，跳过执行中占位）
        const existing = agentMessages.get(chunk.messageId)
        let appendContent = chunk.content || ''
        if (chunk.toolCall && chunk.toolCall.isComplete !== false) {
          appendContent += `[🔧 工具调用: ${chunk.toolCall.tool}] 输入: ${chunk.toolCall.input}\n结果: ${chunk.toolCall.output}\n`
        }
        if (appendContent) {
          if (existing) {
            existing.content += appendContent
          } else {
            agentMessages.set(chunk.messageId, { agentType: chunk.agentType, content: appendContent })
          }
        }

        // 流结束时持久化完整的 Agent 消息
        if (chunk.isComplete) {
          const msgData = agentMessages.get(chunk.messageId)
          if (msgData && msgData.content) {
            // strip <<<AGENT_MSG>>>...<<\/AGENT_MSG>>> 块，避免污染历史记录
            // （流式输出过程中对用户可见，但重载后不可见）
            const cleanContent = msgData.content.replace(
              /<<<AGENT_MSG>>>\s*[\s\S]*?<<<\/AGENT_MSG>>>/g,
              ''
            ).trim()
            if (cleanContent) {
              const outputTokens = Math.ceil(cleanContent.length / 4)
              messagesRepo.insert({
                id: chunk.messageId,
                conversation_id: conversationId,
                role: 'agent',
                agent_type: msgData.agentType,
                content: cleanContent,
                tokens: outputTokens
              })
              // 记录输出 token 使用量
              addTokenUsage(0, outputTokens)
            }
            agentMessages.delete(chunk.messageId)
          }
        }
      }

    } catch (err: any) {
      if (err.name !== 'AbortError') {
        const win = getMainWindow()
        win?.webContents.send('chat:streamError', {
          conversationId,
          error: err.message || '未知错误'
        })
      }
    } finally {
      if (currentAbortController === myController) {
        currentAbortController = null
      }
      // 无论正常结束、abort 还是异常，都必须通知渲染端流结束，
      // 否则 isStreaming 会卡住 true，停止按钮无法回到发送按钮
      const win = getMainWindow()
      win?.webContents.send('chat:streamEnd', { conversationId })
    }
  })

  ipcMain.on('chat:abort', () => {
    currentAbortController?.abort()
  })

  // Token 使用量查询
  ipcMain.handle('token:getUsage', async () => {
    return getCurrentMonthUsage()
  })

  ipcMain.handle('token:getBudget', async () => {
    const config = getAppConfig()
    return {
      ...config.get('tokenBudget'),
      currentUsage: getCurrentMonthUsage(),
      percentage: getBudgetPercentage()
    }
  })

  // 文件附件解析
  ipcMain.handle('chat:uploadAttachment', async (_event, filePath: string): Promise<ParsedAttachment> => {
    return parseFile(filePath)
  })
}
