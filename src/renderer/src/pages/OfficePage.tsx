import { useEffect, useMemo, useRef, useState } from 'react'
import { Input, Tag, Tooltip } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useAgentStore } from '../stores/agentStore'
import { useAgentMessageStore } from '../stores/agentMessageStore'
import type { AgentStatusData } from '../types/agent'
import { AGENT_ICONS, AGENT_NAMES, AGENT_COLORS } from '../types/agent'
import type { AgentMessageItem } from '../stores/agentMessageStore'
import { OfficeCanvas } from '../office/components/OfficeCanvas'
import AgentIcon from '../components/AgentIcon'
import {
  setAgentState as sceneSetAgentState,
  requestDeskVisit as sceneRequestDeskVisit,
  requestDeskVisitTour as sceneRequestDeskVisitTour,
} from '../office/scene/officeSceneBridge'
import type { AgentRosterEntry } from '../office/scene/layout/officeLayout'
import type { AgentState as SceneAgentState } from '../office/types/agent'
import '../office/office.css'

const TYPE_LABELS: Record<string, string> = {
  request: '请求', response: '回应', notification: '通知'
}

const TYPE_COLORS: Record<string, string> = {
  request: '#1E6FCC', response: '#389E0D', notification: '#9CA3AF'
}

/** 临智 Agent 状态 → 办公室场景状态 */
function toSceneState(state: AgentStatusData['state']): SceneAgentState {
  switch (state) {
    case 'thinking':
    case 'waiting':
      return 'thinking'
    case 'working':
      return 'working'
    case 'idle':
    case 'completed':
    case 'error':
    default:
      return 'idle'
  }
}

function hexToNumber(hex: string): number {
  const clean = hex.replace('#', '')
  return parseInt(clean, 16) || 0x722ED1
}

function MessageItem({ msg, resolveName }: { msg: AgentMessageItem; resolveName: (t: string) => { name: string; icon: string; color: string } }): JSX.Element {
  const from = resolveName(msg.fromAgent)
  const to = msg.toAgent === 'all' ? { name: '所有人', icon: 'assets/icons/orchestrator.svg', color: '#9CA3AF' } : resolveName(msg.toAgent)
  const typeColor = TYPE_COLORS[msg.type] || '#9CA3AF'
  const time = new Date(msg.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors border-l-2" style={{ borderColor: typeColor }}>
      <div className="flex items-center gap-2 text-xs mb-1">
        <span className="font-medium inline-flex items-center gap-1" style={{ color: from.color }}>
          <AgentIcon icon={from.icon} className="w-3.5 h-3.5" /> {from.name}
        </span>
        <span className="text-gray-400">→</span>
        <span className="font-medium inline-flex items-center gap-1" style={{ color: to.color }}>
          <AgentIcon icon={to.icon} className="w-3.5 h-3.5" /> {to.name}
        </span>
        <span className="ml-auto text-[10px] text-gray-400">{time}</span>
      </div>
      <div className="flex items-center gap-2 mb-1">
        <Tag color={typeColor} style={{ fontSize: '10px', padding: '0 6px', margin: 0, color: '#fff', border: 'none' }}>
          {TYPE_LABELS[msg.type] || msg.type}
        </Tag>
        {typeof msg.confidence === 'number' && (
          <span className="text-[10px] text-gray-500">置信度 {(msg.confidence * 100).toFixed(0)}%</span>
        )}
      </div>
      <Tooltip title={msg.content} overlayStyle={{ maxWidth: 400 }}>
        <p className="text-xs text-gray-700 line-clamp-3">{msg.content}</p>
      </Tooltip>
    </div>
  )
}

export default function OfficePage(): JSX.Element {
  const agents = useAgentStore((s) => s.agents)
  const messages = useAgentMessageStore((s) => s.messages)
  const clearMessages = useAgentMessageStore((s) => s.clearMessages)
  const [searchTerm, setSearchTerm] = useState('')

  // 仅在 Agent 身份（id/name/color）变化时重建 entries，状态变更不触发场景重建
  const identityKey = agents
    .map((a) => `${a.agentType}:${a.name}:${a.color}`)
    .join('|')

  const entries: AgentRosterEntry[] = useMemo(() => {
    return agents.map((a) => ({
      id: a.agentType,
      name: a.name,
      color: hexToNumber(a.color),
      task: a.currentTask ?? `${a.name} 待命中`,
      state: toSceneState(a.state),
    }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey])

  // Agent 列表加载 + 状态/消息订阅
  useEffect(() => {
    window.aeromind.agent.listStates().then((states) => {
      if (states && states.length > 0) {
        useAgentStore.getState().setAgents(states)
      }
    })

    const unsubStatus = window.aeromind.agent.onStatusUpdate((data: AgentStatusData) => {
      useAgentStore.getState().updateAgentStatus(data)
      sceneSetAgentState(data.agentType, toSceneState(data.state), data.currentTask)
    })

    const unsubMsg = window.aeromind.agent.onMessage((data: AgentMessageItem) => {
      useAgentMessageStore.getState().addMessage(data)
    })

    return () => {
      unsubStatus()
      unsubMsg()
    }
  }, [])

  // 记录已处理消息 id，避免重复触发 desk visit
  const handledMsgIds = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (entries.length === 0) return
    for (const msg of messages) {
      if (handledMsgIds.current.has(msg.id)) continue
      handledMsgIds.current.add(msg.id)

      const visitorIdx = entries.findIndex((e) => e.id === msg.fromAgent)
      if (visitorIdx < 0) continue
      const visitorRosterNo = visitorIdx + 1

      if (msg.toAgent === 'all') {
        const hosts = entries
          .map((e, i) => ({ id: e.id, no: i + 1 }))
          .filter((h) => h.id !== msg.fromAgent)
          .map((h) => h.no)
        if (hosts.length > 0) {
          sceneRequestDeskVisitTour(visitorRosterNo, hosts, () => msg.content)
        }
      } else {
        const hostIdx = entries.findIndex((e) => e.id === msg.toAgent)
        if (hostIdx < 0 || hostIdx === visitorIdx) continue
        sceneRequestDeskVisit(visitorRosterNo, hostIdx + 1, msg.content)
      }
    }
  }, [messages, entries])

  const resolveName = (t: string): { name: string; icon: string; color: string } => {
    const builtin = AGENT_NAMES[t as keyof typeof AGENT_NAMES]
    if (builtin) {
      return {
        name: builtin,
        icon: AGENT_ICONS[t as keyof typeof AGENT_ICONS] || 'assets/icons/orchestrator.svg',
        color: AGENT_COLORS[t as keyof typeof AGENT_COLORS] || '#722ED1'
      }
    }
    const match = agents.find((a) => a.agentType === t)
    return { name: match?.name || t, icon: match?.icon || 'assets/icons/orchestrator.svg', color: match?.color || '#722ED1' }
  }

  const filteredAgents = searchTerm
    ? agents.filter((a) => a.name.includes(searchTerm) || a.agentType.includes(searchTerm.toLowerCase()))
    : agents

  return (
    <div className="h-full flex flex-col p-4 gap-4 overflow-hidden">
      <div className="flex items-center justify-between flex-shrink-0">
        <h2 className="text-lg font-semibold text-gray-900">临智办公室</h2>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索 Agent..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-48"
          size="small"
          allowClear
        />
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* 办公室动画场景 */}
        <div className="flex-1 min-w-0 rounded-card border border-line-light shadow-card overflow-hidden bg-white">
          {entries.length > 0 ? (
            <OfficeCanvas entries={entries} />
          ) : (
            <div className="h-full flex items-center justify-center text-gray-400 text-sm">
              正在加载办公室…
            </div>
          )}
        </div>

        {/* 右侧：Agent 列表 + 通信频道 */}
        <div className="w-80 flex-shrink-0 flex flex-col gap-4 min-h-0">
          <div className="p-3 bg-white rounded-card border border-line-light shadow-card flex-shrink-0">
            <h3 className="text-sm font-medium text-gray-900 mb-2">
              在岗 Agent
              <span className="ml-2 text-xs text-gray-500">（{filteredAgents.length}）</span>
            </h3>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {filteredAgents.map((agent) => (
                <div key={agent.agentType} className="flex items-center gap-2 text-xs">
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: agent.color }}
                  />
                  <span className="text-gray-700 inline-flex items-center gap-1">
                    <AgentIcon icon={AGENT_ICONS[agent.agentType as keyof typeof AGENT_ICONS] || 'assets/icons/orchestrator.svg'} className="w-3.5 h-3.5" /> {agent.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex-1 min-h-0 p-3 bg-white rounded-card border border-line-light shadow-card flex flex-col">
            <div className="flex items-center justify-between mb-3 flex-shrink-0">
              <h3 className="text-sm font-medium text-gray-900">
                Agent 通信频道
                {messages.length > 0 && (
                  <span className="ml-2 text-xs text-gray-500">（最近 {messages.length} 条）</span>
                )}
              </h3>
              {messages.length > 0 && (
                <button onClick={clearMessages} className="text-xs text-gray-400 hover:text-gray-700">
                  清空
                </button>
              )}
            </div>
            {messages.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-xs text-gray-400 text-center">
                <div>
                  <div className="text-3xl mb-2">📭</div>
                  暂无 Agent 间消息
                  <div className="mt-1 text-[10px]">跨领域任务协商时，Agent 之间的结构化消息会实时显示，并驱动小人走动对话</div>
                </div>
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2">
                {messages.map((msg) => (
                  <MessageItem key={msg.id} msg={msg} resolveName={resolveName} />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
