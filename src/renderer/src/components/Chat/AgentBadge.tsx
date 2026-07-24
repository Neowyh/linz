import type { AgentType } from '../../types/agent'
import { AGENT_NAMES, AGENT_COLORS, AGENT_ICONS } from '../../types/agent'
import AgentIcon from '../AgentIcon'

interface AgentBadgeProps {
  agentType: AgentType
}

export default function AgentBadge({ agentType }: AgentBadgeProps): JSX.Element {
  const name = AGENT_NAMES[agentType] || agentType
  const color = AGENT_COLORS[agentType] || '#999'
  const icon = AGENT_ICONS[agentType] || 'assets/icons/orchestrator.svg'

  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium text-white"
      style={{ backgroundColor: color }}
    >
      <AgentIcon icon={icon} className="w-3.5 h-3.5" />
      {name}
    </span>
  )
}
