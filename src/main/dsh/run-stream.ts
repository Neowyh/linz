import type { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getAgentEngine } from '../agents'
import { getMessagesRepo, getConversationsRepo } from '../database'
import { getFileWorkspacePath } from '../store/app-config'
import { estimateTokens } from '../llm'
import {
  StepMarkerStream,
  PanelMarkerStream,
  type StreamChunk,
  type ToolCallData,
  type StepProgressData,
  type PanelCommandPayload
} from '../agents/base.agent'
import type { SkillTriggerInfo } from '../agents/agent-skills.service'
import type { EventBridge } from './event-bridge'
import type { SessionServiceImpl } from './session-service'

interface RunStreamDeps {
  getMainWindow: () => BrowserWindow | null
  eventBridge: EventBridge
  sessionService: SessionServiceImpl
}

/**
 * Shared streaming pipeline used by both `chat:sendMessage` (Phase 2 hook)
 * and `dsh:prompt` (DSH session prompt).
 *
 * Persists the user message, runs the agent engine, forwards StreamChunks to
 * the renderer (chat view), emits DSH events through the EventBridge (map
 * view), persists the final agent message, and updates the session handle's
 * live-reply state for subscribers.
 */
export async function runStream(
  conversationId: string,
  text: string,
  deps: RunStreamDeps
): Promise<void> {
  const { getMainWindow, eventBridge, sessionService } = deps
  const win = getMainWindow()
  const messagesRepo = getMessagesRepo()
  const convRepo = getConversationsRepo()

  // ── Persist user message ──────────────────────────────────
  const userMsgId = uuidv4()
  const userTokens = estimateTokens(text)
  messagesRepo.insert({
    id: userMsgId,
    conversation_id: conversationId,
    role: 'user',
    agent_type: null,
    content: text,
    tokens: userTokens
  })

  // Update conversation title if first message
  const conv = convRepo.getById(conversationId)
  if (conv && conv.title === '新对话') {
    const title = text.length > 30 ? text.substring(0, 30) + '...' : text
    convRepo.updateTitle(conversationId, title)
    eventBridge.onTitleChanged(conversationId, title)
  }

  // Emit user/message DSH event
  eventBridge.onUserMessage(conversationId, text)

  // ── Get agent engine ──────────────────────────────────────
  const engine = getAgentEngine()
  if (!engine) {
    win?.webContents.send('chat:streamError', {
      conversationId,
      error: 'Agent 引擎未初始化，请先配置 DeepSeek API Key 或启用 Ollama'
    })
    win?.webContents.send('chat:streamEnd', { conversationId })
    return
  }

  const fileWorkspacePath = getFileWorkspacePath()
  const abortController = new AbortController()

  // Get session handle for live-reply state updates
  const sessionHandle = sessionService.sessionOf(conversationId)
  sessionHandle?.updateState(true, '')

  // Start streaming
  const stream = engine.handleUserMessage(
    conversationId,
    text,
    abortController.signal,
    undefined,           // selectedAgent (default)
    fileWorkspacePath || undefined,
    undefined,           // dispatchMode (default)
    undefined            // forcedSkillIds
  )

  // Per-message state for aggregation + marker stripping
  const agentMessages = new Map<
    string,
    {
      agentType: string
      content: string
      toolCalls: ToolCallData[]
      skillTriggers: SkillTriggerInfo[]
      doneCount: number
    }
  >()
  const stepStreams = new Map<string, StepMarkerStream>()
  const panelStreams = new Map<string, PanelMarkerStream>()

  try {
    for await (const chunk of stream) {
      if (abortController.signal.aborted) break

      // Strip step + panel markers (same logic as chat.ipc.ts)
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

        let ps = panelStreams.get(chunk.messageId)
        if (!ps) {
          ps = new PanelMarkerStream()
          panelStreams.set(chunk.messageId, ps)
        }
        cleanText = ps.push(cleanText)
        if (ps.commands.length > 0) {
          panelActions = ps.commands.map((c) => ({ ...c, sourceMessageId: chunk.messageId }))
          ps.commands = []
        }
      }

      // Forward to renderer (chat view)
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

      // Forward status changes + inter-agent messages
      if (chunk.statusChange) {
        win?.webContents.send('agent:statusUpdate', chunk.statusChange)
      }
      if (chunk.agentMessage) {
        win?.webContents.send('agent:message', chunk.agentMessage)
      }

      // Emit DSH events
      if (cleanText) {
        eventBridge.onAgentText(conversationId, cleanText)
      }
      if (chunk.toolCall && chunk.toolCall.isComplete !== false) {
        eventBridge.onToolCall(conversationId, chunk.toolCall)
      }

      // Aggregate for persistence (same logic as chat.ipc.ts)
      let msgData = agentMessages.get(chunk.messageId)
      if (!msgData && (chunk.content || chunk.toolCall || chunk.skillTriggers)) {
        msgData = {
          agentType: chunk.agentType,
          content: '',
          toolCalls: [],
          skillTriggers: [],
          doneCount: 0
        }
        agentMessages.set(chunk.messageId, msgData)
      }
      if (msgData) {
        const ss = stepStreams.get(chunk.messageId)
        if (ss) {
          msgData.doneCount = ss.doneCount
        }
        if (cleanText) msgData.content += cleanText
        if (chunk.skillTriggers) {
          for (const t of chunk.skillTriggers) {
            if (!msgData.skillTriggers.some((e) => e.skillId === t.skillId)) {
              msgData.skillTriggers.push(t)
            }
          }
        }
        if (chunk.toolCall && chunk.toolCall.isComplete !== false) {
          const tc = chunk.toolCall
          const idx = tc.toolCallId
            ? msgData.toolCalls.findIndex((c) => c.toolCallId === tc.toolCallId)
            : -1
          if (idx >= 0) msgData.toolCalls[idx] = tc
          else msgData.toolCalls.push(tc)
        }
      }

      // Update live-reply state on session handle
      if (msgData) {
        sessionHandle?.updateState(true, msgData.content)
      }

      // On message completion: persist + emit turn/end
      if (chunk.isComplete) {
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

        const md = agentMessages.get(chunk.messageId)
        if (md && (md.content || md.toolCalls.length > 0 || md.skillTriggers.length > 0)) {
          const cleanContent = md.content.replace(
            /<<<AGENT_MSG>>>\s*[\s\S]*?<<<\/AGENT_MSG>>>/g,
            ''
          ).trim()

          if (cleanContent || md.toolCalls.length > 0 || md.skillTriggers.length > 0) {
            const outputTokens = Math.ceil(cleanContent.length / 4)
            messagesRepo.insert({
              id: chunk.messageId,
              conversation_id: conversationId,
              role: 'agent',
              agent_type: md.agentType,
              content: cleanContent,
              tokens: outputTokens,
              tool_calls: md.toolCalls.length > 0 ? JSON.stringify(md.toolCalls) : null,
              skill_triggers: md.skillTriggers.length > 0 ? JSON.stringify(md.skillTriggers) : null
            })
          }

          // Emit assistant/message + turn/end DSH events
          eventBridge.onTurnEnd(conversationId, chunk.messageId)
          agentMessages.delete(chunk.messageId)
        }
      }
    }
  } catch (err: unknown) {
    const error = err as { name?: string; message?: string }
    if (error.name !== 'AbortError') {
      win?.webContents.send('chat:streamError', {
        conversationId,
        error: error.message || '未知错误'
      })
    }
  } finally {
    sessionHandle?.updateState(false, '')
    win?.webContents.send('chat:streamEnd', { conversationId })
  }
}
