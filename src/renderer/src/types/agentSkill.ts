export interface AgentSkillData {
  id: string
  name: string
  description: string | null
  content: string
  target_agents: string[]      // empty = all agents
  trigger_keywords: string[]   // empty = always-on
  priority: number
  enabled: boolean
  is_builtin: boolean
  is_custom: boolean
  created_at: string
  updated_at: string
  package_path?: string | null  // 导入技能包的落盘目录（含 scripts/），手动创建的技能为 null
}

export const BUILTIN_AGENT_TYPES: Array<{ value: string; label: string }> = [
  { value: 'orchestrator', label: '协调 Agent' },
  { value: 'aero', label: '气动 Agent' },
  { value: 'structural', label: '结构 Agent' },
  { value: 'propulsion', label: '推进 Agent' },
  { value: 'avionics', label: '航电 Agent' },
  { value: 'simulation', label: '仿真 Agent' },
  { value: 'documentation', label: '文档 Agent' },
  { value: 'retriever', label: '检索 Agent' }
]
