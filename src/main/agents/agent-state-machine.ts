import type { AgentState } from './base.agent'

const validTransitions: Record<AgentState, AgentState[]> = {
  idle: ['thinking', 'error'],
  thinking: ['working', 'error'],
  working: ['waiting', 'completed', 'error'],
  waiting: ['thinking', 'working', 'error'],
  completed: ['idle'],
  // 允许从 error 直接恢复到 thinking（orchestrator catch 把 registry 置为 error 后，
  // 下次 run() 可以直接 transition('thinking') 而无需先 reset）
  error: ['idle', 'thinking']
}

export class AgentStateMachine {
  private state: AgentState = 'idle'

  transition(to: AgentState): boolean {
    // 幂等：目标状态与当前一致时直接成功（避免并发/重入场景下的 "thinking -> thinking" 警告）
    if (this.state === to) return true
    const allowed = validTransitions[this.state]
    if (!allowed.includes(to)) {
      console.warn(`[AgentStateMachine] Invalid transition: ${this.state} -> ${to}`)
      return false
    }
    this.state = to
    return true
  }

  getState(): AgentState {
    return this.state
  }

  reset(): void {
    this.state = 'idle'
  }
}
