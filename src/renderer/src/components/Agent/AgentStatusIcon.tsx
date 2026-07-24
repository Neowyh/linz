import type { AgentState } from '../../types/agent'

interface AgentStatusIconProps {
  state: AgentState
}

export default function AgentStatusIcon({ state }: AgentStatusIconProps): JSX.Element {
  const stateStyles: Record<AgentState, { bg: string; animate?: string }> = {
    idle: { bg: 'bg-gray-400' },
    thinking: { bg: 'bg-blue-500', animate: 'animate-pulse' },
    working: { bg: 'bg-green-500', animate: 'animate-pulse' },
    waiting: { bg: 'bg-yellow-500', animate: 'animate-pulse' },
    completed: { bg: 'bg-green-500' },
    error: { bg: 'bg-red-500' }
  }

  const style = stateStyles[state]

  return (
    <span
      className={`inline-block w-3 h-3 rounded-full ${style.bg} ${style.animate || ''}`}
      title={state}
    />
  )
}
