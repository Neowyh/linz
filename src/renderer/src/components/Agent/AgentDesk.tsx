import type { AgentStatusData } from '../../types/agent'
import { AGENT_ICONS } from '../../types/agent'
import AgentStatusIcon from './AgentStatusIcon'
import AgentIcon from '../AgentIcon'

interface AgentDeskProps {
  agent: AgentStatusData
}

export default function AgentDesk({ agent }: AgentDeskProps): JSX.Element {
  const icon = AGENT_ICONS[agent.agentType] || 'assets/icons/orchestrator.svg'

  return (
    <div className="bg-white rounded-card border border-gray-100 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center gap-3 mb-3">
        <div className="relative">
          <AgentIcon icon={icon} className="w-8 h-8" />
          <div className="absolute -bottom-1 -right-1">
            <AgentStatusIcon state={agent.state} />
          </div>
        </div>
        <div>
          <h3 className="text-sm font-medium text-gray-900">{agent.name}</h3>
          <span
            className="text-xs px-2 py-0.5 rounded-full text-white"
            style={{ backgroundColor: agent.color }}
          >
            {agent.state === 'idle' && '待命'}
            {agent.state === 'thinking' && '思考中...'}
            {agent.state === 'working' && '工作中...'}
            {agent.state === 'waiting' && '等待中...'}
            {agent.state === 'completed' && '已完成'}
            {agent.state === 'error' && '出错'}
          </span>
        </div>
      </div>

      {agent.currentTask && (
        <p className="text-xs text-gray-600 mt-2 pl-1 border-l-2 border-primary/30">
          {agent.currentTask}
        </p>
      )}
    </div>
  )
}
