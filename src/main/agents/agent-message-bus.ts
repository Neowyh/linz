import type { AgentMessage, AgentType } from './base.agent'

type MessageHandler = (msg: AgentMessage) => void

class AgentMessageBusImpl {
  private subscribers: Map<AgentType, MessageHandler[]> = new Map()
  private messageStore: Map<AgentType, AgentMessage[]> = new Map()

  publish(msg: AgentMessage): void {
    let targets: AgentType[]
    if (msg.toAgent === 'all') {
      // 从 registry 动态获取所有已注册的 agent 类型
      try {
        const { agentRegistry } = require('./agent-registry')
        targets = agentRegistry.getAllStates().map((s: any) => s.agentType as AgentType)
      } catch {
        targets = ['orchestrator', 'aero', 'structural', 'propulsion', 'avionics', 'simulation', 'documentation', 'retriever']
      }
    } else {
      targets = [msg.toAgent]
    }

    for (const target of targets) {
      if (!this.messageStore.has(target)) {
        this.messageStore.set(target, [])
      }
      this.messageStore.get(target)!.push(msg)

      // Notify subscribers
      const handlers = this.subscribers.get(target)
      if (handlers) {
        for (const handler of handlers) {
          handler(msg)
        }
      }
    }
  }

  subscribe(agentType: AgentType, handler: MessageHandler): void {
    if (!this.subscribers.has(agentType)) {
      this.subscribers.set(agentType, [])
    }
    this.subscribers.get(agentType)!.push(handler)
  }

  unsubscribe(agentType: AgentType, handler: MessageHandler): void {
    const handlers = this.subscribers.get(agentType)
    if (handlers) {
      const idx = handlers.indexOf(handler)
      if (idx >= 0) handlers.splice(idx, 1)
    }
  }

  getMessagesFor(agentType: AgentType): AgentMessage[] {
    return this.messageStore.get(agentType) || []
  }

  clearMessagesFor(agentType: AgentType): void {
    this.messageStore.set(agentType, [])
  }

  clearAll(): void {
    this.messageStore.clear()
  }
}

export const agentMessageBus = new AgentMessageBusImpl()
