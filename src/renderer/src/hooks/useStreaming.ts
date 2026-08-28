import { useEffect, useRef } from 'react'
import { useChatStore } from '../stores/chatStore'
import { useAgentStore } from '../stores/agentStore'
import { useApprovalStore } from '../stores/approvalStore'
import { useStepProgressStore } from '../stores/stepProgressStore'
import { usePanelCommandStore } from '../stores/panelCommandStore'
import type { AgentType } from '../types/agent'
import type { ToolCallEntry, SkillTriggerInfo } from '../types/chat'

export function useStreaming(): void {
  const addAgentMessage = useChatStore((s) => s.addAgentMessage)
  const appendStreamChunk = useChatStore((s) => s.appendStreamChunk)
  const appendThinking = useChatStore((s) => s.appendThinking)
  const upsertToolCall = useChatStore((s) => s.upsertToolCall)
  const addSkillTriggers = useChatStore((s) => s.addSkillTriggers)
  const endStreaming = useChatStore((s) => s.endStreaming)
  const updateAgentStatus = useAgentStore((s) => s.updateAgentStatus)
  const addPendingApproval = useApprovalStore((s) => s.addPending)
  const clearApprovals = useApprovalStore((s) => s.clearAll)
  const beginTask = useStepProgressStore((s) => s.beginTask)
  const setStepPlan = useStepProgressStore((s) => s.setPlan)
  const markStepDone = useStepProgressStore((s) => s.markDone)
  const endStepTask = useStepProgressStore((s) => s.endTask)

  // 跟踪当前活跃的 Agent 消息，避免重复创建
  const activeAgentMessages = useRef<Map<string, string>>(new Map())

  // 确保某 messageId 对应的 Agent 消息气泡已创建
  const ensureAgentMessage = (messageId: string, agentType: AgentType): void => {
    if (!activeAgentMessages.current.has(messageId)) {
      activeAgentMessages.current.set(messageId, agentType)
      addAgentMessage(messageId, agentType)
    }
  }

  useEffect(() => {
    const unsubChunk = window.aeromind.chat.onStreamChunk((data) => {
      const { messageId, agentType, chunk, toolCall, thinking, skillTriggers, stepProgress, panelActions } = data

      // 如果这个 messageId 还没有对应的消息，先创建
      ensureAgentMessage(messageId, agentType as AgentType)

      // 步骤进度：首个带进度的事件到来时激活悬浮卡片（多 agent 只跟踪首个活动的）
      if (stepProgress && useStepProgressStore.getState().sourceMessageId !== messageId) {
        beginTask(messageId)
      }
      if (stepProgress && Array.isArray(stepProgress.steps) && stepProgress.steps.length > 0) {
        setStepPlan(messageId, stepProgress.steps)
        markStepDone(messageId, stepProgress.doneIndex + 1)
      }

      if (chunk) {
        appendStreamChunk(messageId, chunk)
      }
      if (thinking) {
        appendThinking(messageId, thinking)
      }
      if (toolCall) {
        upsertToolCall(messageId, toolCall as ToolCallEntry)
      }
      if (skillTriggers && skillTriggers.length > 0) {
        addSkillTriggers(messageId, skillTriggers as SkillTriggerInfo[])
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
        ensureAgentMessage(messageId, agentType as AgentType)
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

    const unsubEnd = window.aeromind.chat.onStreamEnd(() => {
      endStreaming()
      endStepTask()
      activeAgentMessages.current.clear()
      clearApprovals()
    })

    const unsubError = window.aeromind.chat.onStreamError((data) => {
      console.error('Stream error:', data.error)
      endStreaming()
      endStepTask()
      activeAgentMessages.current.clear()
      clearApprovals()
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
  }, [addAgentMessage, appendStreamChunk, appendThinking, upsertToolCall, addSkillTriggers, endStreaming, updateAgentStatus, addPendingApproval, clearApprovals, beginTask, setStepPlan, markStepDone, endStepTask])
}
