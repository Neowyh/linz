// 共享 Pi 运行器
//
// 把 GeneralAgent.runWithPi 中的逻辑抽出来，所有 Agent（内置 + DynamicAgent）
// 在 engine === 'pi' 时都调用此 helper，避免重复实现。
//
// 流程：
// 1. ensurePi() 加载 SDK（失败抛错，调用方应回退 DeepSeek）
// 2. getOrCreateSession 拿到/创建持久化 session
// 3. subscribeToSession + AsyncQueue 桥接 push → pull
// 4. withRetry 包 session.prompt()，主模型失败尝试 Ollama fallback
// 5. yield StreamChunk 给上层
// 6. abort 时显式调 abortSession 保底

import { v4 as uuidv4 } from 'uuid'
import { ensurePi, isPiAvailable } from './index'
import { getOrCreateSession, abortSession } from './session-manager'
import { subscribeToSession, type PiStreamChunk } from './event-bridge'
import { isOllamaRegistered } from './model-context'
import { withRetry } from '../llm/retry'
import { isOllamaAvailable } from '../llm'
import { getAppConfig } from '../store/app-config'
import type { Tool } from '@langchain/core/tools'
import type { StreamChunk, AgentContext, AgentStatusData, AgentState } from '../agents/base.agent'

// 简单 AsyncQueue：把 push-based 回调转成 pull-based AsyncGenerator
class AsyncQueue<T> {
  private queue: T[] = []
  private waiter: ((v: T | undefined) => void) | null = null
  private closed = false

  push(item: T): void {
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w(item)
    } else {
      this.queue.push(item)
    }
  }

  close(): void {
    this.closed = true
    if (this.waiter) {
      const w = this.waiter
      this.waiter = null
      w(undefined)
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<T> {
    while (true) {
      if (this.queue.length > 0) {
        yield this.queue.shift()!
        continue
      }
      if (this.closed) return
      const item = await new Promise<T | undefined>((resolve) => { this.waiter = resolve })
      if (item === undefined) return
      yield item
    }
  }
}

function isAbortError(err: any): boolean {
  return err?.name === 'AbortError' || (err?.code && ['ABORT_ERR', 'ECANCELED'].includes(err.code))
}

export interface RunWithPiOptions {
  agentType: string
  agentName: string
  agentColor: string
  systemPrompt: string
  task: string  // 已经过 prepareTaskWithContext 处理
  ragContext?: string
  tools?: string[]  // Pi 原生工具名清单（覆盖默认）
  noTools?: 'all' | 'builtin'
  customTools?: Tool[]  // 临智 LangChain 工具（含 MCP / CATIA 等），转成 Pi customTools 注入
}

export async function ensurePiOrThrow(): Promise<void> {
  if (!isPiAvailable()) {
    await ensurePi()
  }
}

export async function* runWithPi(
  context: AgentContext,
  opts: RunWithPiOptions
): AsyncGenerator<StreamChunk> {
  const messageId = uuidv4()

  // 拼接最终 prompt：RAG 上下文 + 任务（Pi Session 自带消息历史，不注入 buildChatHistory）
  const effectiveRag = opts.ragContext ?? context.ragContext
  const promptText = effectiveRag
    ? `[知识库参考]\n${effectiveRag}\n[/知识库参考]\n\n${opts.task}`
    : opts.task

  // Pi 的 bash/grep/find/ls 工具在 Windows 上会通过 Git Bash/WSL 执行命令，
  // 模型容易误判为 Linux 环境。这里显式声明宿主系统，避免路径/命令风格混淆。
  const systemPromptWithHost = `${opts.systemPrompt}\n\n## 宿主环境\n本进程运行于 Windows（Electron 主进程，Node.js）。宿主操作系统是 Windows，文件路径使用反斜杠分隔（如 E:\\lijx\\...）。\nbash 工具会通过 Git Bash / MSYS2 / WSL 的 bash.exe 执行命令，因此命令运行在 POSIX 模拟层中：看到 Unix 风格命令（ls/grep/find）和 /e/lijx/... 形式的路径，但这只是 shell 模拟层，不是真正的 Linux 环境。\n需要操作 Windows 原生程序、注册表或 PowerShell 专属功能时，请通过 bash 调用 powershell.exe -Command "..." 或 cmd.exe /c "..."，不要假设自己在 Linux 中。`

  yield* runWithPiPrompt(context, {
    messageId,
    agentType: opts.agentType,
    agentName: opts.agentName,
    agentColor: opts.agentColor,
    systemPrompt: systemPromptWithHost,
    promptText,
    tools: opts.tools,
    noTools: opts.noTools,
    customTools: opts.customTools
  })
}

interface PromptRunOptions {
  messageId: string
  agentType: string
  agentName: string
  agentColor: string
  systemPrompt: string
  promptText: string
  tools?: string[]
  noTools?: 'all' | 'builtin'
  customTools?: Tool[]
}

async function* runWithPiPrompt(
  context: AgentContext,
  opts: PromptRunOptions
): AsyncGenerator<StreamChunk> {
  await ensurePi()

  let usedFallback = false

  // 第一次尝试：DeepSeek（主模型）
  let session: any
  try {
    session = await getOrCreateSession(context.conversationId, opts.agentType, {
      systemPrompt: opts.systemPrompt,
      provider: 'deepseek',
      tools: opts.tools,
      noTools: opts.noTools,
      cwd: context.fileWorkspacePath,
      customTools: opts.customTools
    })
  } catch (err: any) {
    // DeepSeek context 创建失败（如 Ollama 唯一可用）→ 直接走 Ollama
    if (isAbortError(err) || context.signal.aborted) return
    console.warn(`[PiRunner] DeepSeek session creation failed, trying Ollama:`, err?.message || err)
    const ollamaOk = await canUseOllama()
    if (!ollamaOk) {
      yield makeErrorChunk(opts, `Pi 会话创建失败: ${err?.message || err}`)
      return
    }
    usedFallback = true
    try {
      session = await getOrCreateSession(context.conversationId, opts.agentType, {
        systemPrompt: opts.systemPrompt,
        provider: 'ollama',
        tools: opts.tools,
        noTools: opts.noTools,
        cwd: context.fileWorkspacePath,
        customTools: opts.customTools
      })
    } catch (err2: any) {
      yield makeErrorChunk(opts, `Pi 会话创建失败: ${err2?.message || err2}`)
      return
    }
  }

  if (usedFallback) {
    yield {
      messageId: opts.messageId,
      agentType: opts.agentType,
      content: '⚠️ 云端模型不可用，已切换到本地 Ollama 模型...\n\n',
      isComplete: false
    }
  }

  yield* driveSession(context, opts, session)

  // 显式 abort 保底
  if (context.signal.aborted) {
    await abortSession(context.conversationId, opts.agentType).catch(() => {})
  }
}

async function* driveSession(
  context: AgentContext,
  opts: PromptRunOptions,
  session: any
): AsyncGenerator<StreamChunk> {
  const queue = new AsyncQueue<PiStreamChunk>()
  const unsub = subscribeToSession(session, (chunk) => queue.push(chunk), context.signal)

  // 包一层 retry：session.prompt() 内部走 fetch，重试逻辑同 LangChain 路径
  const promptPromise = (async () => {
    try {
      await withRetry(() => session.prompt(opts.promptText), {
        maxRetries: 3,
        baseDelay: 1000,
        retryOn: (err) => !isAbortError(err) && !context.signal.aborted
      })
      queue.close()
    } catch (err: any) {
      if (isAbortError(err) || context.signal.aborted) {
        queue.close()
        return
      }
      // 主模型重试耗尽 → 尝试 Ollama fallback
      console.warn(`[PiRunner] Primary prompt failed after retries, trying Ollama fallback:`, err?.message || err)
      const ollamaOk = await canUseOllama()
      if (!ollamaOk) {
        queue.push({ error: err?.message || 'prompt failed', isComplete: true })
        queue.close()
        return
      }
      try {
        // 切换 provider 重新创建 session 并重试
        const fallbackSession = await getOrCreateSession(context.conversationId, opts.agentType, {
          systemPrompt: opts.systemPrompt,
          provider: 'ollama',
          tools: opts.tools,
          noTools: opts.noTools,
          cwd: context.fileWorkspacePath,
          customTools: opts.customTools
        })
        // 先推一条提示给用户
        queue.push({ content: '\n\n⚠️ 云端模型不可用，已切换到本地 Ollama 模型...\n\n' })
        // 切换到新 session 的事件流：unsub 旧的，订阅新的
        try { unsub() } catch {}
        const newUnsub = subscribeToSession(fallbackSession, (chunk) => queue.push(chunk), context.signal)
        // 替换闭包内的 unsub 引用（在 finally 中调用最新的）
        activeUnsubRef.unsub = newUnsub
        await fallbackSession.prompt(opts.promptText).catch((e: any) => {
          queue.push({ error: e?.message || 'ollama prompt failed', isComplete: true })
        })
        queue.close()
      } catch (err2: any) {
        queue.push({ error: err2?.message || 'ollama fallback failed', isComplete: true })
        queue.close()
      }
    }
  })()

  const activeUnsubRef = { unsub }

  try {
    for await (const chunk of queue) {
      if (context.signal.aborted) break
      if (chunk.content !== undefined) {
        yield { messageId: opts.messageId, agentType: opts.agentType, content: chunk.content, isComplete: false }
      }
      if (chunk.thinking !== undefined) {
        yield { messageId: opts.messageId, agentType: opts.agentType, content: '', thinking: chunk.thinking, isComplete: false }
      }
      if (chunk.toolCall) {
        yield {
          messageId: opts.messageId,
          agentType: opts.agentType,
          content: '',
          toolCall: chunk.toolCall,
          isComplete: false
        }
      }
      if (chunk.error) {
        console.warn(`[PiRunner] ${opts.agentType} stream error:`, chunk.error)
      }
      if (chunk.isComplete) break
    }
  } finally {
    try { activeUnsubRef.unsub() } catch {}
    await promptPromise.catch(() => {})
  }
}

function makeErrorChunk(opts: PromptRunOptions, message: string): StreamChunk {
  return {
    messageId: opts.messageId,
    agentType: opts.agentType,
    content: `⚠️ ${message}`,
    isComplete: true
  }
}

async function canUseOllama(): Promise<boolean> {
  const cfg = getAppConfig().get('ollama')
  if (!cfg?.enabled) return false
  try {
    if (!await isOllamaAvailable()) return false
    if (!await isOllamaRegistered()) return false
    return true
  } catch {
    return false
  }
}

// 构造状态变更 chunk（供调用方在 thinking/working/completed 阶段使用）
export function makeStatusChunk(
  messageId: string,
  agentType: string,
  agentName: string,
  agentColor: string,
  state: AgentState,
  currentTask?: string
): StreamChunk {
  const statusChange: AgentStatusData = {
    agentType,
    name: agentName,
    color: agentColor,
    state,
    currentTask
  }
  return { messageId, agentType, content: '', statusChange, isComplete: false }
}
