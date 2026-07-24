// LangChain Tool → Pi ToolDefinition 适配器
//
// 临智的工具（内置 calculator/aero_calculator/xfoil/knowledge_search + MCP 工具如 CATIA
// + delegate_to_agent）都是 LangChain Tool 实例，Pi 引擎不能直接识别。
// 此模块把它们包装成 Pi SDK 的 ToolDefinition，通过 createAgentSession({ customTools }) 注册，
// 让 Pi 路径下的 agent 也能调用这些工具。
//
// Schema 策略：LangChain 工具的 Zod schema 转 TypeBox 太重，这里用宽松的 "any object" schema
// （additionalProperties: true）。LLM 通过工具 description 知道参数格式，调用时把 JSON 参数
// 直接传给 LangChain tool.invoke()，工具内部自行解析。

import type { Tool } from '@langchain/core/tools'

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

export interface AdaptedTool {
  name: string
  label: string
  description: string
  parameters: any
  execute: (toolCallId: string, params: any, signal: AbortSignal | undefined) => Promise<{ content: Array<{ type: 'text'; text: string }>; details: undefined }>
}

// 把单个 LangChain Tool 包装成 Pi ToolDefinition 形状
export function adaptLangChainTool(tool: Tool): AdaptedTool {
  const name = tool.name
  const description = (tool as any).description || `工具 ${name}`
  return {
    name,
    label: name,
    description,
    parameters: permissiveObjectSchema(),
    execute: async (_toolCallId, params, signal) => {
      try {
        // LangChain tool.invoke 接受字符串或对象；params 来自 LLM 的 JSON 调用，是对象
        // 部分工具（如 calculator）期望 { expression: string }，直接透传
        const result = await tool.invoke(params ?? {}, signal ? { signal } : undefined)
        const text = toStringResult(result)
        return {
          content: [{ type: 'text' as const, text: text || '(工具无输出)' }],
          details: undefined
        }
      } catch (err: any) {
        const errMsg = err?.message || String(err)
        return {
          content: [{ type: 'text' as const, text: `[工具执行失败] ${errMsg}` }],
          details: undefined
        }
      }
    }
  }
}

export function adaptLangChainTools(tools: Tool[]): AdaptedTool[] {
  return tools.map(adaptLangChainTool)
}

// 转成 createAgentSession 期望的 customTools 格式
// Pi SDK 的 ToolDefinition 字段比 AdaptedTool 多（renderCall/renderResult 等），
// 但都可选；这里只填必要字段。
export function toPiCustomTools(tools: Tool[]): any[] {
  return adaptLangChainTools(tools).map((t) => ({
    name: t.name,
    label: t.label,
    description: t.description,
    parameters: t.parameters,
    execute: t.execute
  }))
}
