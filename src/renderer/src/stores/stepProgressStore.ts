import { create } from 'zustand'

export interface StepItem {
  title: string
  done: boolean
}

interface StepProgressState {
  /** 当前任务步骤（PLAN 后填充）；无任务或已完成时为空数组 */
  steps: StepItem[]
  /** 是否有进行中的任务（决定悬浮卡片显隐） */
  active: boolean
  /** 关联的 agent 消息 messageId（多 agent 时各自独立，仅跟踪最新一个） */
  sourceMessageId: string | null
  /** 发起一次任务：记录来源并清空旧步骤（等待首条 PLAN 到达） */
  beginTask: (messageId: string) => void
  /** 收到计划：写入步骤列表（全部未完成） */
  setPlan: (messageId: string, steps: string[]) => void
  /** 收到完成标记：把前 doneCount 个步骤标记为完成 */
  markDone: (messageId: string, doneCount: number) => void
  /** 任务结束（流结束/错误）：清空卡片 */
  endTask: () => void
}

export const useStepProgressStore = create<StepProgressState>((set) => ({
  steps: [],
  active: false,
  sourceMessageId: null,

  beginTask: (messageId) =>
    set({ active: true, steps: [], sourceMessageId: messageId }),

  setPlan: (messageId, steps) =>
    set((state) => {
      if (state.sourceMessageId !== messageId) return state
      const fresh = steps.map((s) => ({ title: s, done: false }))
      return { active: true, steps: fresh }
    }),

  markDone: (messageId, doneCount) =>
    set((state) => {
      if (state.sourceMessageId !== messageId) return state
      return {
        steps: state.steps.map((s, i) => (i < doneCount ? { ...s, done: true } : s))
      }
    }),

  endTask: () => set({ active: false, steps: [], sourceMessageId: null })
}))