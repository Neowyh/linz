// Pi AgentSession 事件流 → 临智 StreamChunk 适配器
//
// Pi 用 session.subscribe(listener) 推送事件（push-based），
// 临智 IAgent.run() 是 AsyncGenerator（pull-based）。
// 此模块只负责事件类型转换，queue 桥接在调用方实现。

export interface PiStreamChunk {
  content?: string
  thinking?: string  // 思考过程增量
  toolCall?: { toolCallId?: string; tool: string; input: string; output: string; isComplete?: boolean }
  isComplete?: boolean
  error?: string
}

export function subscribeToSession(
  session: any,
  onChunk: (chunk: PiStreamChunk) => void,
  signal: AbortSignal
): () => void {
  // 缓存 tool_execution_start 的参数，等对应的 end 事件到达时合并成完整 ToolCallData
  const pendingToolCalls = new Map<string, { tool: string; input: string; output: string }>()

  const unsub = session.subscribe((event: any) => {
    switch (event.type) {
      case 'message_update': {
        const ame = event.assistantMessageEvent
        if (!ame) break
        if (ame.type === 'text_delta') {
          onChunk({ content: ame.delta })
        } else if (ame.type === 'thinking_delta') {
          // 思考流增量，单独通道输出，UI 折叠展示
          onChunk({ thinking: ame.delta })
        }
        // 其他子类型（start/end/usage 等）忽略
        break
      }
      case 'tool_execution_start': {
        const toolCallId: string = event.toolCallId
        const toolName: string = event.toolName || ''
        const args = event.args
        let inputStr: string
        if (typeof args === 'string') {
          inputStr = args
        } else if (args === undefined || args === null) {
          inputStr = ''
        } else {
          try { inputStr = JSON.stringify(args) } catch { inputStr = String(args) }
        }
        pendingToolCalls.set(toolCallId, { tool: toolName, input: inputStr, output: '' })
        // 推送占位 toolCall（output 为空，isComplete=false），UI 显示"执行中"
        onChunk({
          toolCall: {
            toolCallId,
            tool: toolName,
            input: inputStr,
            output: '',
            isComplete: false
          }
        })
        break
      }
      case 'tool_execution_update': {
        // 流式工具输出增量：累积到对应 pending 条目，推送 isComplete=false 更新
        const toolCallId: string = event.toolCallId
        const pending = pendingToolCalls.get(toolCallId)
        if (!pending) break
        const upd = event.update ?? event.delta ?? event.output
        let delta: string
        if (typeof upd === 'string') {
          delta = upd
        } else if (upd && typeof upd === 'object' && typeof (upd as any).content === 'string') {
          delta = (upd as any).content
        } else {
          break
        }
        if (!delta) break
        pending.output += delta
        onChunk({
          toolCall: {
            toolCallId,
            tool: pending.tool,
            input: pending.input,
            output: pending.output,
            isComplete: false
          }
        })
        break
      }
      case 'tool_execution_end': {
        const toolCallId: string = event.toolCallId
        const toolName: string = event.toolName || ''
        const pending = pendingToolCalls.get(toolCallId)
        pendingToolCalls.delete(toolCallId)
        const inputStr = pending?.input || ''
        let outputStr: string
        const result = event.result
        if (typeof result === 'string') {
          outputStr = result
        } else if (result === undefined || result === null) {
          outputStr = ''
        } else if (typeof result === 'object' && typeof (result as any).content === 'string') {
          // Pi 工具结果常见包装: { content: string, isError?: boolean }
          outputStr = (result as any).content
        } else {
          try { outputStr = JSON.stringify(result) } catch { outputStr = String(result) }
        }
        // 工具若只推流式增量无 result，用累积的流式输出兜底
        if (!outputStr && pending?.output) outputStr = pending.output
        if (event.isError) {
          outputStr = `[工具错误] ${outputStr}`
        }
        // 推送最终 toolCall（isComplete=true），UI 按 toolCallId 更新占位条目
        onChunk({
          toolCall: {
            toolCallId,
            tool: toolName,
            input: inputStr,
            output: outputStr,
            isComplete: true
          }
        })
        break
      }
      case 'agent_end': {
        onChunk({ isComplete: true })
        break
      }
      case 'session_error': {
        onChunk({ error: event.error?.message || 'session error', isComplete: true })
        break
      }
    }
  })

  const onAbort = () => {
    try { session.abort() } catch {}
  }
  signal.addEventListener('abort', onAbort, { once: true })

  return () => {
    signal.removeEventListener('abort', onAbort)
    try { unsub() } catch {}
    pendingToolCalls.clear()
  }
}
