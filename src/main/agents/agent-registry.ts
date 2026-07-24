import type { IAgent, AgentType, BuiltinAgentType, AgentStatusData } from './base.agent'

const BUILTIN_PRIORITY: BuiltinAgentType[] = [
  'orchestrator',
  'aero',
  'structural',
  'propulsion',
  'avionics',
  'simulation',
  'documentation',
  'retriever'
]

class AgentRegistryImpl {
  private agents: Map<string, IAgent> = new Map()

  register(agent: IAgent): void {
    this.agents.set(agent.config.type, agent)
  }

  unregister(type: string): void {
    this.agents.delete(type)
  }

  clearCustomAgents(): void {
    for (const key of Array.from(this.agents.keys())) {
      if (key.startsWith('agent-custom-')) {
        this.agents.delete(key)
      }
    }
  }

  get(type: string): IAgent | undefined {
    return this.agents.get(type)
  }

  getAgentsByPriority(agentTypes: string[]): IAgent[] {
    return [...agentTypes]
      .sort((a, b) => {
        const aIdx = BUILTIN_PRIORITY.indexOf(a as BuiltinAgentType)
        const bIdx = BUILTIN_PRIORITY.indexOf(b as BuiltinAgentType)
        // Builtin agents first (sorted by priority), custom agents after
        if (aIdx !== -1 && bIdx !== -1) return aIdx - bIdx
        if (aIdx !== -1) return -1
        if (bIdx !== -1) return 1
        return 0
      })
      .map((t) => this.agents.get(t))
      .filter((a): a is IAgent => a !== undefined)
  }

  getAllStates(): AgentStatusData[] {
    return Array.from(this.agents.values()).map((a) => ({
      agentType: a.config.type,
      name: a.config.name,
      color: a.config.color,
      state: a.getState(),
      currentTask: undefined
    }))
  }

  // 按 id 精确查找（区分大小写）
  findById(id: string): IAgent | undefined {
    return this.agents.get(id)
  }

  // 按 name 查找（大小写不敏感；去掉首尾空白）
  findByName(name: string): IAgent | undefined {
    const target = name.trim().toLowerCase()
    if (!target) return undefined
    for (const agent of Array.from(this.agents.values())) {
      if (agent.config.name.trim().toLowerCase() === target) {
        return agent
      }
    }
    return undefined
  }

  // 按 id 或 name 综合查找（先 id 精确，再 name 模糊，排除 orchestrator）
  findByMention(token: string): IAgent | undefined {
    if (!token) return undefined
    // 1. id 精确匹配
    const byId = this.agents.get(token)
    if (byId && byId.config.type !== 'orchestrator') return byId
    // 2. name 大小写不敏感匹配
    const byName = this.findByName(token)
    if (byName && byName.config.type !== 'orchestrator') return byName
    return undefined
  }

  resetAll(): void {
    for (const agent of this.agents.values()) {
      agent.forceReset()
    }
  }
}

export const agentRegistry = new AgentRegistryImpl()
