import { useEffect } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAgentStore } from '../stores/agentStore'
import { useApprovalStore } from '../stores/approvalStore'
import { useStepProgressStore } from '../stores/stepProgressStore'
import { usePanelCommandStore } from '../stores/panelCommandStore'
import { useConversationStore } from '../stores/conversationStore'
import type { AgentType } from '../types/agent'
import type { ToolCallEntry, SkillTriggerInfo } from '../types/chat'

export function useStreaming(): void {
  const addAgentMessage = useChatStore((s) => s.addAgentMessage)
  const appendStreamChunk = useChatStore((s) => s.appendStreamChunk)
  const appendThinking = useChatStore((s) => s.appendThinking)
  const upsertToolCall = useChatStore((s) => s.upsertToolCall)
  const addSkillTriggers = useChatStore((s) => s.addSkillTriggers)
  const endStreaming = useChatStore((s) => s.endStreaming)
  const findConversationByMessageId = useChatStore((s) => s.findConversationByMessageId)
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus)
  const addPendingApproval = useApprovalStore((s) => s.addPending)
  const clearApprovals = useApprovalStore((s) => s.clearAll)
  const beginTask = useStepProgressStore((s) => s.beginTask)
  const setStepPlan = useStepProgressStore((s) => s.setPlan)
  const markStepDone = useStepProgressStore((s) => s.markDone)
  const endStepTask = useStepProgressStore((s) => s.endTask)
  const fetchConversations = useConversationStore((s) => s.fetchConversations)

  // 确保某 messageId 对应的 Agent 消息气泡已创建（按 conversationId 路由）。
  // 审批事件无 conversationId，回退用 messageId 反查所属对话，再退到当前对话。
  const ensureAgentMessage = (conversationId: string | null, messageId: string, agentType: AgentType): void => {
    const convId = conversationId ?? findConversationByMessageId(messageId) ?? useChatStore.getState().conversationId
    if (!convId) return
    // addAgentMessage 幂等：已存在则 no-op（替代旧 activeAgentMessages ref 去重）
    addAgentMessage(convId, messageId, agentType)
  }

  useEffect(() => {
    const unsubChunk = window.aeromind.chat.onStreamChunk((data) => {
      const { conversationId, messageId, agentType, chunk, toolCall, thinking, skillTriggers, stepProgress, panelActions } = data

      // 如果这个 messageId 还没有对应的消息，先创建（按 conversationId 路由，支持后台对话）
      ensureAgentMessage(conversationId, messageId, agentType as AgentType)

      // 步骤进度：首个带进度的事件到来时激活悬浮卡片（多 agent 只跟踪首个活动的）
      if (stepProgress && useStepProgressStore.getState().sourceMessageId !== messageId) {
        beginTask(messageId)
      }
      if (stepProgress && Array.isArray(stepProgress.steps) && stepProgress.steps.length > 0) {
        setStepPlan(messageId, stepProgress.steps)
        markStepDone(messageId, stepProgress.doneIndex + 1)
      }

      // 流式增量按 conversationId 路由：命中当前对话写活跃视图，否则写后台缓存槽
      if (chunk) {
        appendStreamChunk(conversationId, messageId, chunk)
      }
      if (thinking) {
        appendThinking(conversationId, messageId, thinking)
      }
      if (toolCall) {
        upsertToolCall(conversationId, messageId, toolCall as ToolCallEntry)
      }
      if (skillTriggers && skillTriggers.length > 0) {
        addSkillTriggers(conversationId, messageId, skillTriggers as SkillTriggerInfo[])
      }
      // 面板指令（对话→面板联动）：Agent 产出 ⟪PANEL⟫ 标记解析而来，
      // 逐条 dispatch 到 panelCommandStore（内部自动 openPanelType 打开对应面板）
      if (Array.isArray(panelActions) && panelActions.length > 0) {
        const store = usePanelCommandStore.getState()
        for (const pa of panelActions) {
          store.dispatch({
            panelType: pa.panelType,
            action: pa.action,
            payload: pa.payload,
            sourceMessageId: pa.sourceMessageId,
            instanceId: pa.instanceId
          })
        }
      }
    })

    // 安全审批请求：在对应消息气泡下挂起审批卡
    const unsubApproval = window.aeromind.approval.onRequest((data: any) => {
      const { requestId, messageId, toolName, risk, argsSummary, agentType, agentName, agentColor, timestamp } = data
      if (messageId && agentType) {
        // 审批 payload 无 conversationId，回退用 messageId 反查所属对话
        const convId = findConversationByMessageId(messageId) ?? useChatStore.getState().conversationId
        if (convId) {
          ensureAgentMessage(convId, messageId, agentType as AgentType)
        }
      }
      addPendingApproval({
        requestId,
        messageId,
        toolName,
        risk,
        argsSummary,
        agentType,
        agentName,
        agentColor,
        timestamp
      })
    })

    // 流结束：按 conversationId 作用域化——后台对话结束只清它自己的缓存槽，
    // 不再误杀当前对话的 isStreaming / 审批 / 步骤进度。后台流完成也刷侧栏。
    const unsubEnd = window.aeromind.chat.onStreamEnd((data: { conversationId?: string }) => {
      const endedConvId = data?.conversationId
      const currentConvId = useChatStore.getState().conversationId
      endStreaming(endedConvId ?? undefined)
      // 仅当结束的是当前对话（或无 conversationId）时，才清当前对话的审批 / 步骤任务
      if (!endedConvId || !currentConvId || endedConvId === currentConvId) {
        endStepTask()
        clearApprovals()
      }
      // 总是刷新侧栏：后台流完成时新消息也需出现在对话列表
      try { fetchConversations() } catch { /* noop */ }
    })

    const unsubError = window.aeromind.chat.onStreamError((data: { conversationId?: string; error: string }) => {
      console.error('Stream error:', data.error)
      const endedConvId = data?.conversationId
      const currentConvId = useChatStore.getState().conversationId
      endStreaming(endedConvId ?? undefined)
      if (!endedConvId || !currentConvId || endedConvId === currentConvId) {
        endStepTask()
        clearApprovals()
      }
    })

    const unsubStatus = window.aeromind.agent.onStatusUpdate((data) => {
      updateAgentStatus(data)
    })

    return () => {
      unsubChunk()
      unsubApproval()
      unsubEnd()
      unsubError()
      unsubStatus()
    }
  }, [addAgentMessage, appendStreamChunk, appendThinking, upsertToolCall, addSkillTriggers, endStreaming, findConversationByMessageId, updateAgentStatus, addPendingApproval, clearApprovals, beginTask, setStepPlan, markStepDone, endStepTask, fetchConversations])
}
