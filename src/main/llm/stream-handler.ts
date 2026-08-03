import { ChatOpenAI } from '@langchain/openai'
import { SystemMessage, HumanMessage, AIMessage, BaseMessage, ToolMessage } from '@langchain/core/messages'
import type { Tool } from '@langchain/core/tools'
import { withRetry } from './retry'
import { createFallbackModel, createOllamaModel, isOllamaAvailable } from './index'
import { extractImageBlocks } from './image-protocol'

export interface StreamOptions {
  systemPrompt: string
  userMessage: string
  chatHistory?: BaseMessage[]
  ragContext?: string
  fallbackModel?: string
  tools?: Tool[]
  signal?: AbortSignal
}

export interface ToolCallResult {
  type: 'tool_call'
  tool: string
  input: string
  output: string
  images?: string[]  // 工具输出中的图片 data URL（已从 output 剥离）
}

export type StreamOutput = string | ToolCallResult

// 工具输出最大字符数（超出截断，避免 LLM 上下文溢出）
const MAX_TOOL_OUTPUT = 10000
// 单个工具调用超时（CATIA 等重型工具可能需要较长时间，但不应无限等待）
const TOOL_TIMEOUT_MS = 120000
// 多轮工具调用最大轮数（防止 LLM 陷入死循环）
const MAX_TOOL_ROUNDS = 100

async function createStream(llm: ChatOpenAI, messages: BaseMessage[], signal?: AbortSignal) {
  return await llm.stream(messages, signal ? { signal } : undefined)
}

function isAbortError(err: any): boolean {
  return err?.name === 'AbortError' || (err?.code && ['ABORT_ERR', 'ECANCELED'].includes(err.code))
}

// 带超时执行工具，避免 CATIA 等工具阻塞整个流
// 若提供 signal，则同时监听 abort 以便尽快返回
async function invokeWithTimeout(tool: Tool, args: any, signal?: AbortSignal): Promise<string> {
  let timer: NodeJS.Timeout | null = null
  const timeoutPromise = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`工具执行超时 (${TOOL_TIMEOUT_MS / 1000}s)`)),
      TOOL_TIMEOUT_MS
    )
  })
  const abortPromise: Promise<never> | null = signal
    ? new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('Aborted'))
        else signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
      })
    : null
  try {
    const racers: Promise<unknown>[] = [
      Promise.resolve().then(() => tool.invoke(args)),
      timeoutPromise
    ]
    if (abortPromise) racers.push(abortPromise)
    const result = await Promise.race(racers)
    return typeof result === 'string' ? result : JSON.stringify(result)
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// 执行工具调用并返回结果消息（带超时 + 输出截断 + abort 监听）
async function executeToolCalls(
  toolCalls: any[],
  tools: Tool[],
  signal?: AbortSignal
): Promise<{ messages: ToolMessage[]; results: ToolCallResult[] }> {
  const toolMap = new Map(tools.map((t) => [t.name, t]))
  const messages: ToolMessage[] = []
  const results: ToolCallResult[] = []

  for (const tc of toolCalls) {
    // 工具循环中检查 abort，避免 abort 后继续执行剩余工具
    if (signal?.aborted) break
    const tool = toolMap.get(tc.name)
    if (!tool) {
      const errorMsg = `工具 ${tc.name} 未找到`
      messages.push(new ToolMessage({ content: errorMsg, tool_call_id: tc.id! }))
      results.push({ type: 'tool_call', tool: tc.name, input: tc.args, output: errorMsg })
      continue
    }

    const input = typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)
    try {
      const outputStr = await invokeWithTimeout(tool, tc.args, signal)
      // 提取图片块（完整保留，直接进对话流），回传 LLM 的文本剥离图片，避免 base64 撑爆上下文
      const { cleanText, images } = extractImageBlocks(outputStr)
      // 截断超长输出，避免 LLM 上下文溢出
      const finalOutput = cleanText.length > MAX_TOOL_OUTPUT
        ? cleanText.slice(0, MAX_TOOL_OUTPUT) + `\n\n... (已截断，原始输出 ${cleanText.length} 字符)`
        : cleanText
      messages.push(new ToolMessage({ content: finalOutput, tool_call_id: tc.id! }))
      results.push({ type: 'tool_call', tool: tc.name, input, output: finalOutput, images })
    } catch (err: any) {
      if (signal?.aborted) break
      const errorMsg = `工具执行失败: ${err.message || String(err)}`
      messages.push(new ToolMessage({ content: errorMsg, tool_call_id: tc.id! }))
      results.push({ type: 'tool_call', tool: tc.name, input, output: errorMsg })
    }
  }

  return { messages, results }
}

// Try Ollama as a last-resort fallback when cloud models are unavailable
async function tryOllamaFallback(): Promise<ChatOpenAI | null> {
  try {
    const available = await isOllamaAvailable()
    if (!available) return null

    console.warn('[StreamHandler] Cloud models failed, falling back to Ollama')
    return createOllamaModel()
  } catch {
    return null
  }
}

// 把累积的 tool_call chunks 合并成完整 tool_calls 列表
function mergeToolCallChunks(
  chunks: any[]
): { toolCalls: any[]; fullContent: string } {
  let fullContent = ''
  const toolCalls: any[] = []
  let currentToolCall: any = null

  for (const chunk of chunks) {
    if (chunk.additional_kwargs?.tool_calls) {
      for (const tc of chunk.additional_kwargs.tool_calls) {
        if (tc.id) {
          if (currentToolCall && currentToolCall.id) {
            toolCalls.push(currentToolCall)
          }
          currentToolCall = {
            id: tc.id,
            name: tc.function?.name || '',
            args: tc.function?.arguments || ''
          }
        } else if (currentToolCall) {
          // 续接参数流（流式工具调用的 arguments 分多块到达）
          currentToolCall.args += tc.function?.arguments || ''
        }
      }
    }
    const content = chunk.content
    if (typeof content === 'string' && content) {
      fullContent += content
    }
  }
  if (currentToolCall && currentToolCall.id) {
    toolCalls.push(currentToolCall)
  }

  return { toolCalls, fullContent }
}

// 流式调用 LLM，返回 AsyncIterable，支持重试、备用模型、多轮工具调用
export async function* streamChat(
  llm: ChatOpenAI,
  options: StreamOptions
): AsyncGenerator<StreamOutput> {
  const messages: BaseMessage[] = [
    new SystemMessage(
      options.ragContext
        ? `${options.systemPrompt}\n\n[知识库参考]\n以下是相关知识库片段，请在回答时参考：\n${options.ragContext}\n[/知识库参考]`
        : options.systemPrompt
    ),
    ...(options.chatHistory || []),
    new HumanMessage(options.userMessage)
  ]

  // 绑定工具（如果提供）
  const hasTools = options.tools && options.tools.length > 0
  const activeLlm = hasTools ? llm.bindTools(options.tools!) : llm

  let stream: AsyncIterable<any>

  try {
    stream = await withRetry(() => createStream(activeLlm as ChatOpenAI, messages, options.signal), {
      maxRetries: 3,
      baseDelay: 1000
    })
  } catch (primaryError: any) {
    if (isAbortError(primaryError) || options.signal?.aborted) {
      return
    }
    const fallback = createFallbackModel(options.fallbackModel)
    if (fallback) {
      console.warn(`[StreamHandler] Primary model failed, trying fallback: ${fallback.modelName}`)
      try {
        const fallbackLlm = hasTools ? fallback.bindTools(options.tools!) : fallback
        stream = await withRetry(() => createStream(fallbackLlm as ChatOpenAI, messages, options.signal), {
          maxRetries: 2,
          baseDelay: 1000
        })
      } catch (fallbackErr) {
        if (isAbortError(fallbackErr) || options.signal?.aborted) return
        const ollamaLlm = await tryOllamaFallback()
        if (ollamaLlm) {
          yield '⚠️ 云端模型不可用，已切换到本地模型...\n\n'
          const activeOllama = hasTools ? ollamaLlm.bindTools(options.tools!) : ollamaLlm
          stream = await createStream(activeOllama as ChatOpenAI, messages, options.signal)
        } else {
          throw primaryError
        }
      }
    } else {
      const ollamaLlm = await tryOllamaFallback()
      if (ollamaLlm) {
        yield '⚠️ 云端模型不可用，已切换到本地模型...\n\n'
        const activeOllama = hasTools ? ollamaLlm.bindTools(options.tools!) : ollamaLlm
        stream = await createStream(activeOllama as ChatOpenAI, messages, options.signal)
      } else {
        throw primaryError
      }
    }
  }

  // 第 0 轮：消费初始流，边读边 yield 文本，收集 tool_calls
  const initialChunks: any[] = []
  try {
    for await (const chunk of stream) {
      if (options.signal?.aborted) break
      initialChunks.push(chunk)
      // 文本内容立即 yield，保持流式体验
      const content = chunk.content
      if (typeof content === 'string' && content) {
        yield content
      }
    }
  } catch (streamError: any) {
    if (isAbortError(streamError) || options.signal?.aborted) {
      return
    }
    console.warn('[StreamHandler] Stream interrupted:', streamError.message)
    throw streamError
  }

  let { toolCalls, fullContent } = mergeToolCallChunks(initialChunks)

  // 多轮工具调用循环：LLM 调用工具 → 执行工具 → 把结果回传 LLM → LLM 可能再次调用工具
  // 直到 LLM 不再调用工具，或达到最大轮数
  let round = 0
  while (toolCalls.length > 0 && hasTools && round < MAX_TOOL_ROUNDS) {
    // 每轮开始前检查 abort，避免 abort 后继续发起 LLM 调用和工具执行
    if (options.signal?.aborted) {
      break
    }
    round++

    // 解析 tool call args
    const parsedToolCalls = toolCalls.map((tc) => {
      let args = tc.args
      try {
        args = JSON.parse(tc.args)
      } catch {
        // Keep as string if not valid JSON
      }
      return { id: tc.id, name: tc.name, args }
    })

    // 添加 AI 消息（包含 tool_calls）到历史
    // 必须使用 OpenAI 标准 tool_calls 格式：{ id, type: 'function', function: { name, arguments } }
    // 否则 DeepSeek API 会返回 400 "missing field 'type'"
    const aiMsg = new AIMessage({
      content: fullContent || '',
      additional_kwargs: {
        tool_calls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: typeof tc.args === 'string' ? tc.args : JSON.stringify(tc.args)
          }
        }))
      }
    })
    messages.push(aiMsg)

    // 执行工具
    const { messages: toolMessages, results } = await executeToolCalls(parsedToolCalls, options.tools!, options.signal)

    // Yield 工具调用结果给 UI；工具产生的图片先以 markdown 图片进入对话流
    for (const result of results) {
      if (result.images && result.images.length > 0) {
        for (const img of result.images) {
          yield `\n\n![图表](${img})\n\n`
        }
      }
      yield result
    }

    // 将工具结果添加到消息历史，供 LLM 继续
    for (const tm of toolMessages) {
      messages.push(tm)
    }

    // 重置本轮收集器
    fullContent = ''
    toolCalls = []
    const roundChunks: any[] = []

    // abort 后不再发起后续 LLM 调用
    if (options.signal?.aborted) {
      break
    }

    // 再次调用 LLM 获取工具调用后的响应
    try {
      const continueStream = await withRetry(() => createStream(activeLlm as ChatOpenAI, messages, options.signal), {
        maxRetries: 2,
        baseDelay: 1000
      })

      for await (const chunk of continueStream) {
        if (options.signal?.aborted) break
        roundChunks.push(chunk)
        const content = chunk.content
        if (typeof content === 'string' && content) {
          yield content
        }
      }

      // 合并本轮 chunks，提取新的 tool_calls（若有则继续下一轮）
      const merged = mergeToolCallChunks(roundChunks)
      toolCalls = merged.toolCalls
      fullContent = merged.fullContent
    } catch (err: any) {
      if (isAbortError(err) || options.signal?.aborted) {
        return
      }
      // 工具调用后的继续对话失败，告知用户并退出循环
      console.warn(`[StreamHandler] Round ${round} post-tool stream failed:`, err.message)
      yield `\n\n> ⚠️ 工具调用后的继续对话失败: ${err.message || String(err)}\n\n`
      break
    }
  }

  if (round >= MAX_TOOL_ROUNDS && toolCalls.length > 0) {
    yield `\n\n> ⚠️ 已达到最大工具调用轮数 (${MAX_TOOL_ROUNDS})，停止继续调用。\n\n`
  }
}
