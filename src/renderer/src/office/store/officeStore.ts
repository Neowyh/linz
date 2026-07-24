import type { Agent } from '../types/agent'

let agents: Agent[] = []

export function getOfficeAgents(): Agent[] {
  return agents
}

export function setOfficeAgents(nextAgents: Agent[]) {
  agents = nextAgents
}
