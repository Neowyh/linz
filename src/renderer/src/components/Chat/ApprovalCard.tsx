import { useEffect, useState } from 'react'
import { Button, Tag, Tooltip, message } from 'antd'
import {
  SafetyOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  CloseCircleOutlined,
  EnvironmentOutlined,
  WarningFilled
} from '@ant-design/icons'
import type { PendingApproval } from '../../stores/approvalStore'
import { useApprovalStore } from '../../stores/approvalStore'
import AgentBadge from './AgentBadge'

const RISK_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  write: { label: '写入', color: '#FA8C16', bg: '#fff7e6' },
  execute: { label: '执行', color: '#CF1322', bg: '#fff1f0' },
  delegate: { label: '委派', color: '#722ED1', bg: '#f9f0ff' },
  network: { label: '网络', color: '#08979C', bg: '#e6fffb' },
  read: { label: '只读', color: '#9CA3AF', bg: '#f3f4f6' }
}

// 各风险等级的用户可见警示文案（审批确认前必须充分知情）
const RISK_WARN: Record<string, string> = {
  execute: '将执行外部代码。脚本可能读写或删除文件、访问网络、调用系统命令，不受工作空间围栏约束。请仅对来源可靠、你了解其内容的技能包允许执行。',
  write: '将覆盖工作空间内的文件，原内容可能被替换丢失。如需保留原文件，请先手动备份。',
  delegate: '将委派子任务给其他 Agent，目标 Agent 可调用其拥有的全部工具（含写文件、执行脚本）。',
  network: '将访问外部网络，可能上传数据或下载内容。',
  read: '只读操作，不会修改数据。'
}

const APPROVAL_TIMEOUT_MS = 120_000

export default function ApprovalCard({ approval }: { approval: PendingApproval }): JSX.Element {
  const [submitting, setSubmitting] = useState(false)
  const [remaining, setRemaining] = useState(APPROVAL_TIMEOUT_MS / 1000)
  const removePending = useApprovalStore((s) => s.removePending)
  const risk = RISK_STYLE[approval.risk] || RISK_STYLE.network
  const warn = RISK_WARN[approval.risk] || RISK_WARN.network

  // 倒计时：提示审批卡将自动超时拒绝
  useEffect(() => {
    const timer = setInterval(() => {
      const left = Math.max(0, Math.round(APPROVAL_TIMEOUT_MS / 1000 - (Date.now() - approval.timestamp) / 1000))
      setRemaining(left)
      if (left <= 0) clearInterval(timer)
    }, 1000)
    return () => clearInterval(timer)
  }, [approval.timestamp])

  const respond = async (decision: 'approve' | 'deny', remember: boolean): Promise<void> => {
    if (submitting) return
    setSubmitting(true)
    try {
      const ok = await window.aeromind.approval.respond(approval.requestId, decision, remember)
      removePending(approval.requestId)
      if (!ok) {
        message.info('该审批请求已超时或被处理')
      } else if (decision === 'approve') {
        message.success(remember ? '已批准并记住该操作' : '已批准执行')
      } else {
        message.info('已拒绝该操作')
      }
    } catch (err: any) {
      message.error(`操作失败: ${err?.message || '未知错误'}`)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="border rounded-md text-xs overflow-hidden shadow-sm" style={{ borderColor: risk.color }}>
      <div className="flex items-center gap-2 px-3 py-1.5" style={{ backgroundColor: risk.bg }}>
        <SafetyOutlined style={{ color: risk.color, fontSize: 12 }} />
        <span className="font-medium text-gray-800">安全确认</span>
        <Tag color={risk.color} style={{ fontSize: '10px', padding: '0 6px', margin: 0, color: '#fff', border: 'none' }}>
          {risk.label}
        </Tag>
        <span className="font-mono font-medium text-gray-700">{approval.toolName}</span>
        {approval.agentType && (
          <span className="ml-auto">
            <AgentBadge agentType={approval.agentType} />
          </span>
        )}
      </div>

      <div className="px-3 py-2 bg-white space-y-2">
        <div>
          <div className="text-[10px] text-gray-500 mb-0.5">请求内容</div>
          <pre className="font-mono text-[11px] bg-gray-50 border border-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-32">
            {approval.argsSummary || '（无可展示参数）'}
          </pre>
        </div>

        {/* 风险警示：按等级强调可能的后果，执行类最高警示 */}
        <div
          className="flex items-start gap-1.5 rounded px-2.5 py-2 border"
          style={{
            borderColor: approval.risk === 'execute' ? '#CF1322' : '#FAAD14',
            backgroundColor: approval.risk === 'execute' ? '#fff1f0' : '#fffbe6'
          }}
        >
          <WarningFilled style={{ color: approval.risk === 'execute' ? '#CF1322' : '#FAAD14', fontSize: 12, marginTop: 1 }} />
          <span className="text-[11px] leading-relaxed" style={{ color: approval.risk === 'execute' ? '#a8071a' : '#ad6800' }}>
            {warn}
          </span>
        </div>

        <div className="flex items-center gap-1 text-[10px] text-gray-400">
          <ClockCircleOutlined style={{ fontSize: 10 }} />
          <span>{remaining} 秒后自动拒绝（未确认视为拒绝）</span>
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="small"
            type="primary"
            icon={<CheckCircleOutlined />}
            disabled={submitting}
            onClick={() => respond('approve', false)}
          >
            允许一次
          </Button>
          <Tooltip title="记住该操作（同参数）后续不再询问，可在设置中撤销">
            <Button
              size="small"
              icon={<EnvironmentOutlined />}
              disabled={submitting}
              onClick={() => respond('approve', true)}
            >
              始终允许
            </Button>
          </Tooltip>
          <Button
            size="small"
            danger
            icon={<CloseCircleOutlined />}
            disabled={submitting}
            onClick={() => respond('deny', false)}
          >
            拒绝
          </Button>
        </div>
      </div>
    </div>
  )
}
