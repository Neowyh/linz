import type { AgentType } from '../../types/agent'
import { useAgentStore } from '../../stores/agentStore'
import { useCustomAgentStore } from '../../stores/customAgentStore'
import { resolveAgentDisplay } from '../../utils/agentDisplay'
import AgentIcon from '../AgentIcon'

interface AgentBadgeProps {
  agentType: AgentType
}

export default function AgentBadge({ agentType }: AgentBadgeProps): JSX.Element {
  const agents = useAgentStore((s) => s.agents)
  const customAgents = useCustomAgentStore((s) => s.agents)
  const { name, color, icon } = resolveAgentDisplay(agentType, agents, customAgents)

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
