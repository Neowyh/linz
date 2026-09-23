export type BuiltinAgentType = 'orchestrator' | 'general' | 'aero' | 'structural' | 'propulsion' | 'avionics' | 'simulation' | 'documentation' | 'retriever' | 'codereviewer'

export type AgentType = BuiltinAgentType | string

export type AgentState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error'

export interface AgentStatusData {
  agentType: AgentType
  name: string
  color: string
  state: AgentState
  currentTask?: string
}

export const AGENT_NAMES: Record<string, string> = {
  orchestrator: '协调 Agent',
  general: '普通对话',
  aero: '气动 Agent',
  structural: '结构 Agent',
  propulsion: '推进 Agent',
  avionics: '航电 Agent',
  simulation: '仿真 Agent',
  documentation: '文档 Agent',
  retriever: '检索 Agent',
  codereviewer: '代码审查 Agent'
}

export const AGENT_COLORS: Record<string, string> = {
  orchestrator: '#722ED1',
  general: '#1677FF',
  aero: '#1E6FCC',
  structural: '#FA8C16',
  propulsion: '#CF1322',
  avionics: '#08979C',
  simulation: '#722ED1',
  documentation: '#389E0D',
  retriever: '#1890FF',
  codereviewer: '#13C2C2'
}

export const AGENT_ICONS: Record<string, string> = {
  orchestrator: 'assets/icons/orchestrator.svg',
  general: 'assets/icons/general.svg',
  aero: 'assets/icons/aero.svg',
  structural: 'assets/icons/structural.svg',
  propulsion: 'assets/icons/propulsion.svg',
  avionics: 'assets/icons/avionics.svg',
  simulation: 'assets/icons/simulation.svg',
  documentation: 'assets/icons/documentation.svg',
  retriever: 'assets/icons/retriever.svg',
  codereviewer: 'assets/icons/codereviewer.svg'
}

export const AGENT_DELEGATES: Record<string, string[]> = {
  orchestrator: ['general', 'aero', 'structural', 'propulsion', 'avionics', 'simulation', 'documentation', 'retriever'],
  general: ['retriever'],
  aero: ['simulation', 'retriever'],
  structural: ['simulation', 'retriever'],
  propulsion: ['retriever'],
  avionics: ['retriever'],
  simulation: ['aero', 'retriever'],
  documentation: ['retriever'],
  retriever: [],
  codereviewer: ['retriever']
}
