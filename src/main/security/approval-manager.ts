// 审批管理器：主进程持有 pending 请求，向渲染端发 approval:request 事件，
// 渲染端通过 approval:respond 应答，此处 resolve 对应的 Promise。
// 超时自动拒绝（默认 120s），无窗口时直接拒绝。

import { BrowserWindow } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { getAppConfig } from '../store/app-config'

export interface ApprovalInput {
  fingerprint: string
  toolName: string
  risk: string
  argsSummary: string
  agentType: string
  agentName: string
  agentColor: string
  messageId?: string
}

export interface ApprovalRequestPayload extends ApprovalInput {
  requestId: string
  timestamp: number
}

export interface ApprovalResult {
  approved: boolean
  remember: boolean
  source: 'user' | 'timeout'
}

interface PendingRequest {
  resolve: (r: ApprovalResult) => void
  timer: NodeJS.Timeout
}

class ApprovalManagerImpl {
  private pending = new Map<string, PendingRequest>()

  requestApproval(input: ApprovalInput): Promise<ApprovalResult> {
    return new Promise((resolve) => {
      const requestId = uuidv4()
      const payload: ApprovalRequestPayload = { ...input, requestId, timestamp: Date.now() }

      const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed() && w.isVisible())
      if (!win) {
        resolve({ approved: false, remember: false, source: 'timeout' })
        return
      }

      const timeoutMs = getAppConfig().get('approvalTimeoutMs') || 120000
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        resolve({ approved: false, remember: false, source: 'timeout' })
      }, timeoutMs)

      this.pending.set(requestId, { resolve, timer })
      win.webContents.send('approval:request', payload)
    })
  }

  // 渲染端应答。返回 false 表示 requestId 不存在（已超时/已处理）
  handleResponse(requestId: string, decision: 'approve' | 'deny', remember: boolean): boolean {
    const req = this.pending.get(requestId)
    if (!req) return false
    clearTimeout(req.timer)
    this.pending.delete(requestId)
    req.resolve({ approved: decision === 'approve', remember, source: 'user' })
    return true
  }

  // 清空所有 pending（切换工作区/退出等场景），全部按拒绝处理
  clearAll(): void {
    for (const [, req] of this.pending) {
      clearTimeout(req.timer)
      req.resolve({ approved: false, remember: false, source: 'timeout' })
    }
    this.pending.clear()
  }

  pendingCount(): number {
    return this.pending.size
  }
}

export const approvalManager = new ApprovalManagerImpl()
