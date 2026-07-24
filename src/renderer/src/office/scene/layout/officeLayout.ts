import type { Agent, AgentState, Desk } from '../../types/agent'

export const SCENE_WIDTH = 960
export const SCENE_HEIGHT = 640

export const COLORS = {
  floor: 0xffffff,
  wall: 0xe8e6e1,
  desk: 0xffffff,
  deskShadow: 0x00000014,
  monitor: 0x2a2a2a,
  chair: 0xd4d2cc,
  agentBody: 0x1a1a1a,
} as const

/** 工位阵列间距 */
const DESK_COL_GAP = 150
const DESK_ROW_GAP = 140
export const SEAT_OFFSET_Y = 45

export type AgentRosterEntry = {
  id: string
  name: string
  color: number
  task: string
  state?: AgentState
}

let desks: Desk[] = []
let roster: AgentRosterEntry[] = []
let initialAgents: Agent[] = []

export function getDesks(): Desk[] {
  return desks
}

export function getRoster(): AgentRosterEntry[] {
  return roster
}

export function getInitialAgents(): Agent[] {
  return initialAgents
}

function buildDesks(n: number): Desk[] {
  if (n <= 0) return []
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)))
  const rows = Math.max(1, Math.ceil(n / cols))
  const blockWidth = (cols - 1) * DESK_COL_GAP
  const blockHeight = (rows - 1) * DESK_ROW_GAP
  const originX = (SCENE_WIDTH - blockWidth) / 2
  const originY = (SCENE_HEIGHT - blockHeight) / 2

  const result: Desk[] = []
  for (let i = 0; i < n; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const x = originX + col * DESK_COL_GAP
    const y = originY + row * DESK_ROW_GAP
    result.push({
      id: `desk-${i}`,
      x,
      y,
      seatX: x,
      seatY: y + SEAT_OFFSET_Y,
    })
  }
  return result
}

function buildInitialAgents(entries: AgentRosterEntry[], builtDesks: Desk[]): Agent[] {
  return entries.map((entry, i) => {
    const desk = builtDesks[i] ?? builtDesks[0]
    const state: AgentState = entry.state ?? 'idle'
    return {
      id: entry.id,
      name: entry.name,
      color: entry.color,
      x: desk.seatX,
      y: desk.seatY,
      state,
      currentTask: state === 'idle' ? undefined : entry.task,
      assignedDeskId: desk.id,
      facing: i % 2 === 0 ? 1 : -1,
      viewFacing:
        state === 'working' || state === 'thinking' ? ('back' as const) : ('front' as const),
    }
  })
}

/**
 * 根据真实 Agent 列表重建工位阵列、名册与初始 Agent。
 * 工位数量随 entries.length 动态扩展（列数 = ceil(sqrt(N))）。
 * 必须在创建 OfficeScene 之前调用。
 */
export function configureOfficeLayout(entries: AgentRosterEntry[]): void {
  roster = entries.map((e) => ({ ...e }))
  desks = buildDesks(entries.length)
  initialAgents = buildInitialAgents(roster, desks)
}

/** 交接流程中的状态标签（头顶 / 侧栏） */
export const HANDOFF_STATUS = {
  delivering: '交接递送中…',
  handingOff: '正在交接…',
  receiving: '接收交接中…',
  wrappingUp: '交接收尾中…',
  planning: '规划交接中…',
} as const

/** 离座拜访时交给对方的话术 */
const HANDOFF_VISIT_MESSAGES: ((hostName: string) => string)[] = [
  (n) => `${n}，这件事交给你了。`,
  (n) => `${n}，轮到你了，说明在工单里。`,
  (n) => `${n}，接力给你，上下文在线程里。`,
  (n) => `${n}，你队列里有最新的交接包。`,
  (n) => `${n}，工单已转给你，我这边解除了阻塞。`,
  (n) => `${n}，能从这里接手吗？`,
  (n) => `${n}，我这边交接完成，交给你了。`,
  (n) => `${n}，收到后请确认一下。`,
]

export function pickHandoffVisitMessage(
  hostName: string,
  hostRosterNo: number,
): string {
  const i = Math.abs(hostRosterNo - 1) % HANDOFF_VISIT_MESSAGES.length
  return HANDOFF_VISIT_MESSAGES[i]!(hostName)
}
