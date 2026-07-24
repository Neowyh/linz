import type { OfficeScene } from './OfficeScene'
import type { AgentState } from '../types/agent'

let scene: OfficeScene | null = null

type PendingDeskVisit = {
  kind: 'desk_visit'
  visitorRosterNo: number
  hostRosterNo: number
  message: string
}

type PendingDeskVisitTour = {
  kind: 'desk_visit_tour'
  visitorRosterNo: number
  hostRosterNos: number[]
  messageFn?: (hostRosterNo: number, hostName: string) => string
}

type PendingSetState = {
  kind: 'set_state'
  agentId: string
  state: AgentState
  task?: string
}

type PendingAction = PendingDeskVisit | PendingDeskVisitTour | PendingSetState

const pendingActions: PendingAction[] = []

function flushPendingActions() {
  if (!scene || pendingActions.length === 0) return

  const queue = pendingActions.splice(0)
  for (const action of queue) {
    if (action.kind === 'desk_visit') {
      scene.requestDeskVisit(action.visitorRosterNo, action.hostRosterNo, action.message)
    } else if (action.kind === 'desk_visit_tour') {
      scene.requestDeskVisitTour(action.visitorRosterNo, action.hostRosterNos, action.messageFn)
    } else {
      scene.setAgentState(action.agentId, action.state, action.task)
    }
  }
}

export function bindOfficeScene(instance: OfficeScene | null) {
  scene = instance
  if (instance) flushPendingActions()
}

/** 名册序号从 1 开始，例如 1 号去找 5 号 */
export function requestDeskVisit(
  visitorRosterNo: number,
  hostRosterNo: number,
  message: string,
) {
  if (!scene) {
    pendingActions.push({ kind: 'desk_visit', visitorRosterNo, hostRosterNo, message })
    return
  }
  scene.requestDeskVisit(visitorRosterNo, hostRosterNo, message)
}

/** 1 号依次拜访 2、3、4… 号，全部说完后回座 */
export function requestDeskVisitTour(
  visitorRosterNo: number,
  hostRosterNos: number[],
  messageFn?: (hostRosterNo: number, hostName: string) => string,
) {
  if (!scene) {
    pendingActions.push({ kind: 'desk_visit_tour', visitorRosterNo, hostRosterNos, messageFn })
    return
  }
  scene.requestDeskVisitTour(visitorRosterNo, hostRosterNos, messageFn)
}

export function isOfficeSceneReady() {
  return scene != null
}

export function setAgentState(agentId: string, state: AgentState, task?: string) {
  if (!scene) {
    pendingActions.push({ kind: 'set_state', agentId, state, task })
    return
  }
  scene.setAgentState(agentId, state, task)
}
