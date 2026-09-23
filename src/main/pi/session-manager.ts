// Pi AgentSession 生命周期管理
//
// 按 conversationId+agentType 维度懒创建独立 session，复用历史。
// 持久化模式：SessionManager.create(cwd, sessionDir) 落盘到
//   userData/workspaces/{wsId}/pi-sessions/{conversationId}/{agentType}/
// 重启后能续会话；workspace 切换时清空内存缓存（重新创建时从磁盘恢复）。

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { ensurePi } from './index'
import { getModelContext, getOllamaModelContext, type ModelContext, type PiProvider } from './model-context'
import { getCurrentWorkspace } from '../store/app-config'
import { toPiCustomTools, type SecurityContextHolder, type ImageSinkHolder } from './tool-adapter'
import type { Tool } from '@langchain/core/tools'

interface SessionEntry {
  session: any
  systemPrompt: string
  provider: PiProvider
  cwd?: string
  customToolNames: string  // 工具名有序串指纹，用于复用判定（比数量更严，工具内容变化也触发重建）
  securityContextHolder: SecurityContextHolder  // customTools 闭包绑定的 holder，runner 每次 prompt 前更新 .current
  imageSinkHolder: ImageSinkHolder  // customTools 闭包绑定的图片接收器，runner 每次 driveSession 更新 .push
}

const sessions = new Map<string, SessionEntry>()

function sessionKey(conversationId: string, agentType: string): string {
  return `${conversationId}+${agentType}`
}

function getWorkspaceRoot(): string {
  const ws = getCurrentWorkspace()
  if (!ws) return app.getPath('userData')
  return path.join(app.getPath('userData'), 'workspaces', ws.id)
}

function getPiConfigDir(): string {
  return path.join(app.getPath('userData'), 'pi-config')
}

function getSessionDir(conversationId: string, agentType: string): string {
  const dir = path.join(getWorkspaceRoot(), 'pi-sessions', conversationId, agentType)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

// 禁用 Pi 所有原生工具（bash/read/grep/find/ls）：它们不经临智中央安全门
// （permission.service / approvalManager / getBlockedByArgs），构成未经审批/审计的文件访问面。
// 文件操作改由已接入安全门的 customTools 承担：file_read/file_list/file_write（工作空间内）
// 与 code_tree/code_read/code_search（代码审查），均经路径校验与审批门。
// 配置优先级：显式 noTools > 显式 tools > 默认 noTools:'builtin'（见 createSessionForProvider）。

export interface CreateSessionOptions {
  systemPrompt: string
  provider?: PiProvider  // 'deepseek' 默认；'ollama' 用于 fallback
  tools?: string[]  // 覆盖默认工具清单
  noTools?: 'all' | 'builtin'  // 显式禁用
  cwd?: string  // 工作目录，决定 Pi 内置 bash/read/write 工具的执行目录；默认用 userData
  customTools?: Tool[]  // 临智的 LangChain 工具（含 MCP / 内置 / 自定义），转成 Pi customTools 注入
  securityContextHolder?: SecurityContextHolder  // 注入到 customTools 闭包，供安全门读取当前审批/审计上下文
  imageSinkHolder?: ImageSinkHolder  // 注入到 customTools 闭包，工具剥离的图片通过此 sink 推给 runner
}

async function createSessionForProvider(
  opts: CreateSessionOptions,
  ctx: ModelContext
): Promise<any> {
  const pi = await ensurePi()
  const conversationId = opts.__conversationId!
  const agentType = opts.__agentType!
  const sessionDir = getSessionDir(conversationId, agentType)
  const configDir = getPiConfigDir()

  // cwd 决定 Pi bash/read/write/grep/find/ls 的工作目录
  // 优先用 opts.cwd（来自 AgentContext.fileWorkspacePath，即用户设置的工作空间目录）
  // 其次回退到当前工作区根目录，最后回退到 userData
  const cwd = opts.cwd && opts.cwd.trim().length > 0
    ? opts.cwd
    : (getWorkspaceRoot() || app.getPath('userData'))
  // 确保 cwd 存在
  if (!fs.existsSync(cwd)) {
    try { fs.mkdirSync(cwd, { recursive: true }) } catch {}
  }

  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir: configDir,
    systemPromptOverride: () => opts.systemPrompt
  })
  await loader.reload()

  // 工具配置优先级：显式 noTools > 显式 tools > AGENT_PI_TOOLS 默认
  let toolsOption: any = {}
  if (opts.noTools) {
    toolsOption = { noTools: opts.noTools }
  } else if (opts.tools && opts.tools.length >= 0) {
    if (opts.tools.length === 0) {
      toolsOption = { noTools: 'all' }
    } else {
      toolsOption = { tools: opts.tools }
    }
  } else {
    // 默认禁用 Pi 原生工具（不经安全门），仅用 customTools
    toolsOption = { noTools: 'builtin' }
  }

  // 把临智的 LangChain 工具转成 Pi customTools（注入安全门 holder）
  // 这些工具（含 MCP / CATIA 等）通过 createAgentSession customTools 注入，与 Pi 原生工具并存
  const customTools = opts.customTools && opts.customTools.length > 0
    ? toPiCustomTools(opts.customTools, opts.securityContextHolder, opts.imageSinkHolder)
    : []

  // 持久化到 sessionDir；workspace 隔离靠 sessionDir 路径
  // 第一个参数 cwd 是 Pi 工作目录，第二个 sessionDir 是会话文件落盘目录
  const sessionManager = pi.SessionManager.create(cwd, sessionDir)

  const sessionOpts: any = {
    model: ctx.model,
    authStorage: ctx.authStorage,
    modelRegistry: ctx.modelRegistry,
    sessionManager,
    resourceLoader: loader,
    cwd,
    ...toolsOption
  }
  if (customTools.length > 0) {
    sessionOpts.customTools = customTools
  }

  const { session } = await pi.createAgentSession(sessionOpts)

  // 启用 auto-compaction（Pi 内置上下文压缩，替代临智 compressContext 在 Pi 路径下的作用）
  try {
    if (typeof session.setAutoCompaction === 'function') {
      session.setAutoCompaction(true)
    }
  } catch (err) {
    console.warn('[Pi] Failed to enable auto-compaction:', err)
  }

  return session
}

// 内部扩展接口
interface CreateSessionOptionsInternal extends CreateSessionOptions {
  __conversationId?: string
  __agentType?: string
}

export async function getOrCreateSession(
  conversationId: string,
  agentType: string,
  opts: { systemPrompt: string; provider?: PiProvider; tools?: string[]; noTools?: 'all' | 'builtin'; cwd?: string; customTools?: Tool[] }
): Promise<{ session: any; securityContextHolder: SecurityContextHolder; imageSinkHolder: ImageSinkHolder }> {
  const key = sessionKey(conversationId, agentType)
  const requestedProvider = opts.provider || 'deepseek'

  // session 复用条件：systemPrompt + provider + cwd + customToolNames 都一致
  // 任意变化都要重建（用户编辑了 agent / 切换工作空间 / 增减/替换工具）
  // 用工具名有序串而非数量：工具从 [calculator] 换成 [knowledge_search]（数量同）也会触发重建
  const existing = sessions.get(key)
  const customToolNames = (opts.customTools && opts.customTools.length > 0)
    ? opts.customTools.map((t) => t.name).sort().join(',')
    : ''
  if (
    existing &&
    existing.systemPrompt === opts.systemPrompt &&
    existing.provider === requestedProvider &&
    existing.cwd === opts.cwd &&
    existing.customToolNames === customToolNames
  ) {
    return { session: existing.session, securityContextHolder: existing.securityContextHolder, imageSinkHolder: existing.imageSinkHolder }
  }
  if (existing) {
    try { existing.session.dispose() } catch {}
    sessions.delete(key)
  }

  const ctx = requestedProvider === 'ollama'
    ? await getOllamaModelContext()
    : await getModelContext()

  // 为本次 session 创建 holder：与 customTools 闭包共享引用，
  // runner 在每次 session.prompt() 前更新 holder.current（含当轮 messageId/审批 setState）
  const securityContextHolder: SecurityContextHolder = { current: null }
  // 图片接收器：runner 每次 driveSession 时更新 push，把工具剥离的图片推到当前对话流
  const imageSinkHolder: ImageSinkHolder = { push: null }

  const internalOpts: CreateSessionOptionsInternal = {
    ...opts,
    securityContextHolder,
    imageSinkHolder,
    __conversationId: conversationId,
    __agentType: agentType
  }
  const session = await createSessionForProvider(internalOpts, ctx)

  sessions.set(key, {
    session,
    systemPrompt: opts.systemPrompt,
    provider: requestedProvider,
    cwd: opts.cwd,
    customToolNames,
    securityContextHolder,
    imageSinkHolder
  })
  console.log(`[Pi] Session created for ${key} (provider=${requestedProvider}, cwd=${opts.cwd || '(default)'}, customTools=${customToolNames || 'none'})`)
  return { session, securityContextHolder, imageSinkHolder }
}

export async function abortSession(conversationId: string, agentType: string): Promise<void> {
  const key = sessionKey(conversationId, agentType)
  const entry = sessions.get(key)
  if (!entry) return
  try { await entry.session.abort() } catch (err) {
    console.warn(`[Pi] abortSession failed for ${key}:`, err)
  }
}

// 销毁内存中所有 session（不删除磁盘文件，下次创建时从磁盘恢复）
export async function disposeAll(): Promise<void> {
  const entries = Array.from(sessions.values())
  sessions.clear()
  await Promise.all(
    entries.map(async (e) => {
      try { await e.session.dispose() } catch {}
    })
  )
  console.log(`[Pi] Disposed ${entries.length} sessions`)
}

// workspace 切换时清空所有 session（不同工作区数据隔离）
export async function clearAllSessions(): Promise<void> {
  await disposeAll()
}

// 持久化清理：删除某个 conversation 的所有 agent session 文件
export function deleteConversationSessions(conversationId: string): void {
  try {
    const dir = path.join(getWorkspaceRoot(), 'pi-sessions', conversationId)
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch (err) {
    console.warn(`[Pi] Failed to delete sessions for ${conversationId}:`, err)
  }
}
