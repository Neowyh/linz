// LangChain Tool → Pi ToolDefinition 适配器
//
// 临智的工具（内置 calculator/aero_calculator/xfoil/knowledge_search + MCP 工具如 CATIA
// + delegate_to_agent）都是 LangChain Tool 实例，Pi 引擎不能直接识别。
// 此模块把它们包装成 Pi SDK 的 ToolDefinition，通过 createAgentSession({ customTools }) 注册，
// 让 Pi 路径下的 agent 也能调用这些工具。
//
// 关键：Pi 路径下 customTools 的 execute 与 DeepSeek 路径（stream-handler.ts）一样
// 接入中央安全门——策略判定 + 文件防护 + 用户审批 + 审计，避免 Pi 路径工具调用无门可过。
//
// Schema 策略：LangChain 工具的 Zod schema 转 TypeBox 太重，这里用宽松的 "any object" schema
// （additionalProperties: true）。LLM 通过工具 description 知道参数格式，调用时把 JSON 参数
// 直接传给 LangChain tool.invoke()，工具内部自行解析。

import type { Tool } from '@langchain/core/tools'
import { resolveDecision, rememberApproval, summarizeArgs } from '../agents/tools/permission.service'
import { approvalManager } from '../security/approval-manager'
import { writeAudit, type AuditDecision } from '../security/audit'
import { getBlockedByArgs } from '../security/file-protection'
import type { SecurityContext } from '../agents/base.agent'

// 安全上下文持有者：customTools 闭包在 session 创建时绑定，session 会被复用，
// 而 messageId 每次对话都不同，故不能在闭包里直接捕获 securityContext。
// 改为捕获此 holder 引用，runner 在每次 session.prompt() 前更新 holder.current。
export interface SecurityContextHolder {
  current: SecurityContext | null
}

// TypeBox schema 在运行时只是带 `~kind` 字段的普通对象（参见 typebox 源码 schema.mjs 的 IsKind 实现）
// 这里手构一个宽松对象 schema，等价于 Type.Object({}, { additionalProperties: true })
function permissiveObjectSchema(): any {
  return {
    '~kind': 'Object',
    type: 'object',
    properties: {},
    additionalProperties: true
  }
}

function toStringResult(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'object') {
    // LangChain 工具常用包装: { content: string } 或 JSON
    const v = value as any
    if (typeof v.content === 'string') return v.content
    if (typeof v.output === 'string') return v.output
    if (typeof v.result === 'string') return v.result
    try { return JSON.stringify(v) } catch { return String(v) }
  }
  return String(value)
}

function blockedResult(text: string): { content: Array<{ type: 'text'; text: string }>; details: undefined } {
  return { content: [{ type: 'text' as const, text }], details: undefined }
}

// 让 promise 同时响应 abort：用户中断流时立即抛错返回，不悬挂等待审批
function withAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(new Error('Aborted'))
  return new Promise((resolve, reject) => {
    const onAbort = (): void => reject(new Error('Aborted'))
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (v) => { signal.removeEventListener('abort', onAbort); resolve(v) },
      (e) => { signal.removeEventListener('abort', onAbort); reject(e) }
    )
  })
}

export interface AdaptedTool {
  name: string
  label: string
  description: string
  parameters: any
  execute: (toolCallId: string, params: any, signal: AbortSignal | undefined) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: undefined }>
}

// 把单个 LangChain Tool 包装成 Pi ToolDefinition 形状，并在 execute 内执行安全门。
// holder 可选：未提供时（不应发生）文件防护/策略 deny 仍生效，但 ask 路径 fail-closed 拒绝。
export function adaptLangChainTool(tool: Tool, holder?: SecurityContextHolder): AdaptedTool {
  const name = tool.name
  const description = (tool as any).description || `工具 ${name}`
  return {
    name,
    label: name,
    description,
    parameters: permissiveObjectSchema(),
    execute: async (_toolCallId, params, signal) => {
      const args = params ?? {}
      const ctx = holder?.current ?? null
      const decision = resolveDecision(name, args)
      const auditBase = {
        conversationId: ctx?.conversationId,
        agentType: ctx?.agentType,
        toolName: name,
        argsSummary: summarizeArgs(name, args),
        risk: decision.risk
      }

      // ===== 文件防护门：参数中的绝对路径命中受保护路径，直接拦截（优先级高于权限审批） =====
      const protectedBlock = getBlockedByArgs(args)
      if (protectedBlock) {
        if (ctx) {
          writeAudit({ ...auditBase, decision: 'deny', source: 'protected-path', durationMs: 0 })
        }
        return blockedResult(`⛔ 文件防护拦截：${protectedBlock.path}\n（命中受保护路径：${protectedBlock.protectedPath}）`)
      }

      // ===== 安全策略门：deny 在真正执行前拦截 =====
      if (decision.action === 'deny') {
        if (ctx) {
          writeAudit({ ...auditBase, decision: 'deny', source: decision.reason, durationMs: 0 })
        }
        return blockedResult(`操作被安全策略拒绝：${name}（${decision.reason}）`)
      }

      let auditDecision: AuditDecision = 'allow'
      let auditSource = decision.reason
      let auditStarted = Date.now()

      // ===== ask：弹用户审批卡，等待应答 =====
      if (decision.action === 'ask') {
        if (!ctx) {
          // 无审批上下文（runner 未注入 holder.current）：fail-closed 拒绝，防无门绕过
          return blockedResult(`操作需用户审批但无审批上下文：${name}`)
        }
        ctx.setState('waiting')
        auditStarted = Date.now()
        let result: { approved: boolean; remember: boolean; source: 'user' | 'timeout' }
        try {
          result = await withAbort(
            approvalManager.requestApproval({
              fingerprint: decision.fingerprint,
              toolName: name,
              risk: decision.risk,
              argsSummary: summarizeArgs(name, args),
              agentType: ctx.agentType,
              agentName: ctx.agentName,
              agentColor: ctx.agentColor,
              messageId: ctx.messageId
            }),
            signal
          )
        } catch (abortErr) {
          ctx.setState('working')
          throw abortErr
        }
        ctx.setState('working')

        if (!result.approved) {
          if (ctx) {
            writeAudit({ ...auditBase, decision: result.source === 'timeout' ? 'timeout' : 'deny', source: result.source, durationMs: Date.now() - auditStarted })
          }
          const msg = result.source === 'timeout'
            ? `操作未获确认（审批超时自动拒绝）：${name}`
            : `操作已被用户拒绝：${name}`
          return blockedResult(msg)
        }

        if (result.remember) rememberApproval(name, args)
        auditDecision = 'approve'
        auditSource = result.remember ? 'remember' : 'user'
      } else {
        // allow（策略放行或命中记忆）
        auditDecision = decision.reason.includes('已记住') ? 'remembered' : 'allow'
        auditSource = decision.reason
      }

      // ===== 执行工具 =====
      auditStarted = Date.now()
      try {
        const result = await tool.invoke(args, signal ? { signal } : undefined)
        const text = toStringResult(result)
        if (ctx) {
          writeAudit({ ...auditBase, decision: auditDecision, source: auditSource, durationMs: Date.now() - auditStarted })
        }
        return { content: [{ type: 'text', text: text || '(工具无输出)' }], details: undefined }
      } catch (err: any) {
        // abort 传播给 Pi（让会话停止），不当作普通工具失败
        if (err?.name === 'AbortError' || signal?.aborted) throw err
        if (ctx) {
          writeAudit({ ...auditBase, decision: 'deny', source: `error: ${err?.message || String(err)}`, durationMs: Date.now() - auditStarted })
        }
        const errMsg = err?.message || String(err)
        return blockedResult(`[工具执行失败] ${errMsg}`)
      }
    }
  }
}

export function adaptLangChainTools(tools: Tool[], holder?: SecurityContextHolder): AdaptedTool[] {
  return tools.map((t) => adaptLangChainTool(t, holder))
}

// 转成 createAgentSession 期望的 customTools 格式
// Pi SDK 的 ToolDefinition 字段比 AdaptedTool 多（renderCall/renderResult 等），
// 但都可选；这里只填必要字段。
export function toPiCustomTools(tools: Tool[], holder?: SecurityContextHolder): any[] {
  return adaptLangChainTools(tools, holder).map((t) => ({
    name: t.name,
    label: t.label,
    description: t.description,
    parameters: t.parameters,
    execute: t.execute
  }))
}
