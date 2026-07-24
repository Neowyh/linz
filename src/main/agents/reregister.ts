import { OrchestratorAgent } from './orchestrator.agent'
import { GeneralAgent } from './general.agent'
import { AeroAgent } from './aero.agent'
import { StructuralAgent } from './structural.agent'
import { PropulsionAgent } from './propulsion.agent'
import { AvionicsAgent } from './avionics.agent'
import { SimulationAgent } from './simulation.agent'
import { DocumentationAgent } from './documentation.agent'
import { RetrieverAgent } from './retriever.agent'
import { agentRegistry } from './agent-registry'
import { getBuiltinAgentOverrides, refreshCustomKeywordCache } from './custom-agents.service'
import type { AgentOverrideConfig } from './base.agent'

const BUILTIN_TYPES = ['orchestrator','general','aero','structural','propulsion','avionics','simulation','documentation','retriever']

export function reregisterBuiltinAgents(): void {
  let overrides: Record<string, AgentOverrideConfig> = {}
  try {
    overrides = getBuiltinAgentOverrides()
  } catch (err) {
    console.warn('[Agents] Failed to load built-in agent overrides:', err)
  }

  for (const type of BUILTIN_TYPES) {
    agentRegistry.unregister(type)
  }

  agentRegistry.register(new OrchestratorAgent(overrides['orchestrator']))
  agentRegistry.register(new GeneralAgent(overrides['general']))
  agentRegistry.register(new AeroAgent(overrides['aero']))
  agentRegistry.register(new StructuralAgent(overrides['structural']))
  agentRegistry.register(new PropulsionAgent(overrides['propulsion']))
  agentRegistry.register(new AvionicsAgent(overrides['avionics']))
  agentRegistry.register(new SimulationAgent(overrides['simulation']))
  agentRegistry.register(new DocumentationAgent(overrides['documentation']))
  agentRegistry.register(new RetrieverAgent(overrides['retriever']))

  try {
    refreshCustomKeywordCache()
  } catch {}
}
