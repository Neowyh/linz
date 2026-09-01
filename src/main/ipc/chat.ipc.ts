import { ipcMain, BrowserWindow } from 'electron'
import { getAgentEngine } from '../agents'
import { getMessagesRepo, getConversationsRepo } from '../database'
import { isOverBudget, getBudgetPercentage, addTokenUsage, getAppConfig, getCurrentMonthUsage, getFileWorkspacePath } from '../store/app-config'
import { estimateTokens } from '../llm'
import { v4 as uuidv4 } from 'uuid'
import { parseFile, formatAttachmentContent, type ParsedAttachment } from '../parsers'
import type { ToolCallData, StepProgressData, PanelCommandPayload } from '../agents/base.agent'
import { StepMarkerStream, PanelMarkerStream } from '../agents/base.agent'
import type { SkillTriggerInfo } from '../agents/agent-skills.service'
import { getEventBridge } from '../dsh'

let mainWindowRef: BrowserWindow | null = null
let currentAbortController: AbortController | null = null

function getMainWindow(): BrowserWindow | null {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) return mainWindowRef
  const wins = BrowserWindow.getAllWindows()
  return wins.length > 0 ? wins[0] : null
}

export function registerChatIPC(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow

  ipcMain.on('chat:sendMessage', async (_event, { conversationId, content, selectedAgent, dispatchMode, skillIds }) => {
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

      // DSH 兼容层：发射 user/message 事件
      getEventBridge()?.onUserMessage(conversationId, content)

      // 更新对话标题（如果是第一条消息）
      const conv = convRepo.getById(conversationId)
      if (conv && conv.title === '新对话') {
        const title = content.length > 30 ? content.substring(0, 30) + '...' : content
        convRepo.updateTitle(conversationId, title)
        getEventBridge()?.onTitleChanged(conversationId, title)
      }

      // 获取 Agent 引擎并处理
      const engine = getAgentEngine()
      if (!engine) {
        win?.webContents.send('chat:streamError', {
          conversationId,
          error: 'Agent 引擎未初始化，请先配置 DeepSeek API Key 或启用 Ollama 离线模式'
        })
        return
      }

      const fileWorkspacePath = getFileWorkspacePath()
      const stream = engine.handleUserMessage(conversationId, content, myController.signal, selectedAgent, fileWorkspacePath, dispatchMode, Array.isArray(skillIds) ? skillIds : undefined)

      // 按 messageId 聚合流式内容，用于最终持久化
      // 工具调用/技能触发结构化累积，不再拼进 content（否则重载会话时以纯文本展开显示）
      const agentMessages = new Map<string, { agentType: string; content: string; toolCalls: ToolCallData[]; skillTriggers: SkillTriggerInfo[]; steps: string[]; doneCount: number }>()
      // 每个 message 一个跨 chunk 的步骤标记解析器
      const stepStreams = new Map<string, StepMarkerStream>()
      // 每个 message 一个跨 chunk 的面板指令标记解析器（⟪PANEL⟫...⟫/PANEL⟫）
      const panelStreams = new Map<string, PanelMarkerStream>()

      for await (const chunk of stream) {
        if (myController.signal.aborted) break

        // 跨 chunk 剥离标记：先剥离步骤标记，再剥离面板标记，拿到干净文本
        let cleanText = chunk.content
        let stepProgress: StepProgressData | undefined
        let panelActions: PanelCommandPayload[] | undefined
        if (chunk.content) {
          let ss = stepStreams.get(chunk.messageId)
          if (!ss) {
            ss = new StepMarkerStream()
            stepStreams.set(chunk.messageId, ss)
          }
          cleanText = ss.push(chunk.content)
          if (ss.plan.length > 0) {
            stepProgress = { steps: [...ss.plan], doneIndex: ss.doneCount - 1 }
          }
          // 再过面板标记剥离器（此时 cleanText 已无 STEP 标记）
          let ps = panelStreams.get(chunk.messageId)
          if (!ps) {
            ps = new PanelMarkerStream()
            panelStreams.set(chunk.messageId, ps)
          }
          cleanText = ps.push(cleanText)
          if (ps.commands.length > 0) {
            // 携带 sourceMessageId 供渲染端双向高亮回溯
            panelActions = ps.commands.map((c) => ({ ...c, sourceMessageId: chunk.messageId }))
            ps.commands = []  // 已取走，避免重复转发
          }
        }

        win?.webContents.send('chat:streamChunk', {
          conversationId,
          messageId: chunk.messageId,
          agentType: chunk.agentType,
          chunk: cleanText,
          toolCall: chunk.toolCall,
          thinking: chunk.thinking,
          skillTriggers: chunk.skillTriggers,
          stepProgress,
          panelActions
        })

        if (chunk.statusChange) {
          win?.webContents.send('agent:statusUpdate', chunk.statusChange)
        }

        // 转发 agent 间结构化消息到办公室可视化
        if (chunk.agentMessage) {
          win?.webContents.send('agent:message', chunk.agentMessage)
        }

        // DSH 兼容层：发射 assistant 文本增量 + tool call 事件
        if (cleanText) {
          getEventBridge()?.onAgentText(conversationId, cleanText)
        }
        if (chunk.toolCall && chunk.toolCall.isComplete !== false) {
          getEventBridge()?.onToolCall(conversationId, chunk.toolCall)
        }

        // 聚合内容（跳过执行中占位；完成的工具调用按 toolCallId 去重更新）
        let msgData = agentMessages.get(chunk.messageId)
        if (!msgData && (chunk.content || chunk.toolCall || chunk.skillTriggers)) {
          msgData = { agentType: chunk.agentType, content: '', toolCalls: [], skillTriggers: [], steps: [], doneCount: 0 }
          agentMessages.set(chunk.messageId, msgData)
        }
        if (msgData) {
          // 同步解析器里的步骤进度到聚合数据（供持久化/进度跟踪）
          const ss = stepStreams.get(chunk.messageId)
          if (ss) {
            msgData.steps = [...ss.plan]
            msgData.doneCount = ss.doneCount
          }
          if (cleanText) {
            msgData.content += cleanText
          }
          if (chunk.skillTriggers) {
            for (const t of chunk.skillTriggers) {
              if (!msgData.skillTriggers.some((e) => e.skillId === t.skillId)) {
                msgData.skillTriggers.push(t)
              }
            }
          }
          if (chunk.toolCall && chunk.toolCall.isComplete !== false) {
            const tc = chunk.toolCall
            const idx = tc.toolCallId ? msgData.toolCalls.findIndex((c) => c.toolCallId === tc.toolCallId) : -1
            if (idx >= 0) {
              msgData.toolCalls[idx] = tc
            } else {
              msgData.toolCalls.push(tc)
            }
          }
        }

        // 流结束时持久化完整的 Agent 消息
        if (chunk.isComplete) {
          // 末尾遗留的缓冲：未闭合的步骤/面板标记丢弃，普通文本补入正文
          const ss = stepStreams.get(chunk.messageId)
          const flushTail = ss ? ss.flush() : ''
          if (flushTail) {
            const m = agentMessages.get(chunk.messageId)
            if (m) m.content += flushTail
          }
          const ps = panelStreams.get(chunk.messageId)
          const flushPanelTail = ps ? ps.flush() : ''
          if (flushPanelTail) {
            const m = agentMessages.get(chunk.messageId)
            if (m) m.content += flushPanelTail
          }
          const msgData = agentMessages.get(chunk.messageId)
          if (msgData && (msgData.content || msgData.toolCalls.length > 0 || msgData.skillTriggers.length > 0)) {
            // strip <<<AGENT_MSG>>>...<<\/AGENT_MSG>>> 块，避免污染历史记录
            // （流式输出过程中对用户可见，但重载后不可见）
            const cleanContent = msgData.content.replace(
              /<<<AGENT_MSG>>>\s*[\s\S]*?<<<\/AGENT_MSG>>>/g,
              ''
            ).trim()
            if (cleanContent || msgData.toolCalls.length > 0 || msgData.skillTriggers.length > 0) {
              const outputTokens = Math.ceil(cleanContent.length / 4)
              messagesRepo.insert({
                id: chunk.messageId,
                conversation_id: conversationId,
                role: 'agent',
                agent_type: msgData.agentType,
                content: cleanContent,
                tokens: outputTokens,
                tool_calls: msgData.toolCalls.length > 0 ? JSON.stringify(msgData.toolCalls) : null,
                skill_triggers: msgData.skillTriggers.length > 0 ? JSON.stringify(msgData.skillTriggers) : null
              })
              // 记录输出 token 使用量
              addTokenUsage(0, outputTokens)
              // DSH 兼容层：发射 assistant/message + turn/end 事件
              getEventBridge()?.onTurnEnd(conversationId, chunk.messageId)
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
