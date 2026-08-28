import { DynamicStructuredTool } from '@langchain/core/tools'
import { z } from 'zod'
import { agentRegistry } from '../agent-registry'
import type { AgentContext, StreamChunk } from '../base.agent'

const MAX_DELEGATION_DEPTH = 2
const DELEGATION_TIMEOUT_MS = 120000

export interface DelegateToolDeps {
  callerType: string
  allowedTargets: string[]
  context: AgentContext
  onChunk?: (chunk: StreamChunk) => void
}

export function createDelegateTool(deps: DelegateToolDeps): DynamicStructuredTool<z.ZodObject<{ target_agent: z.ZodString; task: z.ZodString }>> {
  const { callerType, allowedTargets, context, onChunk } = deps
  const targetList = allowedTargets.join(', ')

  return new DynamicStructuredTool({
    name: 'delegate_to_agent',
    description: `将子任务委派给其他专业 Agent 处理。你可以委派给以下 Agent: ${targetList}。参数: target_agent(目标Agent类型), task(任务描述)`,
    schema: z.object({
      target_agent: z.string().describe('要委派的目标 Agent 类型，如 aero, structural, simulation 等'),
      task: z.string().describe('委托给目标 Agent 的子任务描述')
    }),
    func: async ({ target_agent, task }): Promise<string> => {
      // Authorization check
      if (!allowedTargets.includes(target_agent)) {
        return `错误: 当前 Agent 无权委派给 ${target_agent}。可委派的 Agent: ${targetList}`
      }

      // Depth check
      const currentDepth = context.delegationDepth ?? 0
      if (currentDepth >= MAX_DELEGATION_DEPTH) {
        return `错误: 已达到最大委派深度(${MAX_DELEGATION_DEPTH})，无法继续委派`
      }

      // Abort check
      if (context.signal.aborted) {
        return '错误: 任务已被取消'
      }

      // Get target agent from registry
      const agent = agentRegistry.get(target_agent)
      if (!agent) {
        return `错误: 找不到 Agent "${target_agent}"`
      }

      // Build delegation context with incremented depth
      const delegateContext: AgentContext = {
        ...context,
        delegationDepth: currentDepth + 1,
        ragContext: undefined  // delegated agents do their own RAG if needed
      }

      try {
        const chunks: string[] = []
        let timer: NodeJS.Timeout | null = null
        // 给委派任务独立的 AbortController：超时或外部 abort 时，
        // 既放弃 Promise.race 等待，也通过 signal 通知被委派 agent.run() 停止（agent.run 内多处检查 signal.aborted）。
        const delegateAbort = new AbortController()
        const onParentAbort = (): void => { delegateAbort.abort() }
        if (context.signal.aborted) {
          delegateAbort.abort()
        } else {
          context.signal.addEventListener('abort', onParentAbort, { once: true })
        }

        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            delegateAbort.abort()  // 通知被委派 agent 停止
            reject(new Error('委派超时'))
          }, DELEGATION_TIMEOUT_MS)
        })

        // 被委派 agent 的 context 用 delegateAbort.signal 替换，确保超时/abort 能传播
        const delegateRunContext: AgentContext = {
          ...delegateContext,
          signal: delegateAbort.signal
        }

        try {
          const runPromise = (async () => {
            for await (const chunk of agent.run(task, delegateRunContext)) {
              if (delegateAbort.signal.aborted || context.signal.aborted) break
              if (chunk.content) {
                chunks.push(chunk.content)
              }
              onChunk?.(chunk)
            }
            return chunks.join('')
          })()

          const result = await Promise.race([runPromise, timeoutPromise])
          return result || '（委派的 Agent 未返回内容）'
        } finally {
          if (timer) clearTimeout(timer)
          context.signal.removeEventListener('abort', onParentAbort)
        }
      } catch (err: any) {
        if (context.signal.aborted) {
          return '委派已取消'
        }
        return `委派执行失败: ${err.message || String(err)}`
      }
    }
  })
}
