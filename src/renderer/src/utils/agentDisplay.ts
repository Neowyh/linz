import { AGENT_NAMES, AGENT_COLORS, AGENT_ICONS } from '../types/agent'
import type { AgentStatusData } from '../types/agent'
import type { CustomAgentData } from '../types/customAgent'
import { useAgentStore } from '../stores/agentStore'
import { useCustomAgentStore } from '../stores/customAgentStore'

const DEFAULT_ICON = 'assets/icons/orchestrator.svg'
const DEFAULT_COLOR = '#999'

export interface AgentDisplayInfo {
  name: string
  color: string
  icon: string
}

/**
 * 解析 agent 显示信息：内置静态映射 → 运行时 agent 状态列表 → 自定义 agent 列表。
 * 自定义 agent 的 agentType 为 agent-custom-<uuid>，静态映射中不存在，
 * 必须查动态列表，否则会直接把原始 id 显示给用户。
 */
export function resolveAgentDisplay(
  agentType: string,
  agents: AgentStatusData[],
  customAgents: CustomAgentData[]
): AgentDisplayInfo {
  const builtinName = AGENT_NAMES[agentType]
  if (builtinName) {
    return {
      name: builtinName,
      color: AGENT_COLORS[agentType] || DEFAULT_COLOR,
      icon: AGENT_ICONS[agentType] || DEFAULT_ICON
    }
  }

  const runtime = agents.find((a) => a.agentType === agentType)
  if (runtime) {
    return { name: runtime.name, color: runtime.color || DEFAULT_COLOR, icon: DEFAULT_ICON }
  }

  const custom = customAgents.find((a) => a.id === agentType)
  if (custom) {
    return { name: custom.name, color: custom.color || DEFAULT_COLOR, icon: custom.icon || DEFAULT_ICON }
  }

  return { name: agentType, color: DEFAULT_COLOR, icon: DEFAULT_ICON }
}

/** 非组件环境（如导出回调）使用：直接从 store 取当前快照解析 */
export function resolveAgentDisplaySnapshot(agentType: string): AgentDisplayInfo {
  return resolveAgentDisplay(
    agentType,
    useAgentStore.getState().agents,
    useCustomAgentStore.getState().agents
  )
}
