/**
 * DSH (DeepSeek Harness) type definitions.
 *
 * These interfaces mirror the shapes that DSH Cordis plugins expect from the
 * host context (`ctx`). They are derived from reading dsh-synapse's index.js
 * and client.js source, and cover the server-side service surface.
 */

// ─── Session events ───────────────────────────────────────────────

export interface SessionEventContentBlock {
  type: 'text' | 'tool-call' | 'tool-result'
  text?: string
  name?: string
  arguments?: string
  content?: SessionEventContentBlock[]
}

export interface SessionEventData {
  // user/message
  content?: SessionEventContentBlock[]
  // assistant/message
  turn?: number
  step?: number
  message?: {
    content?: SessionEventContentBlock[]
    source?: { callId?: string }
  }
  // tool/call
  callId?: string
  name?: string
  arguments?: string
  // tool/result
  error?: { name?: string; code?: string; message?: string }
  // turn/end
  reason?: { kind?: string; error?: unknown }
  // session/title
  title?: string
  // todo/write
  todos?: Array<{ status: string; content: string }>
}

export interface SessionEvent {
  type: string
  seq: number
  time: string
  data: SessionEventData
}

// ─── Session ──────────────────────────────────────────────────────

export interface SessionHeader {
  meta?: { cwd?: string }
  cwd?: string
  parentSession?: string
  seedLength?: number
}

export interface DshSession {
  id: string
  title: string | undefined
  firstLiveSeq: number
  header: SessionHeader
  events: SessionEvent[]
}

// ─── Session snapshot (client-side reactive) ──────────────────────

export interface SessionListItem {
  id: string
  displayTitle: string
  cwd: string | null
  parentId?: string | null
  blank?: boolean
}

export interface SessionListSnapshot {
  ids: string[]
  byId: Record<string, SessionListItem>
  current?: string
}

export interface SessionStateSnapshot {
  partial: { blocks: Array<{ kind: string; text: string }> }
  running: boolean
  chat: { nodes: Map<string, { key: string; anchorSeq: number }> }
}

export interface PromptResult {
  ok: boolean
  error?: { message?: string }
}

// ─── Workspaces ───────────────────────────────────────────────────

export interface WorkspaceItem {
  workspaceId: string
  title: string
  path: string | null
  sessionIds: string[]
}

export interface WorkspaceListSnapshot {
  items: WorkspaceItem[]
}

// ─── Web server ───────────────────────────────────────────────────

export type RouteKind = 'exact' | 'prefix'

export interface RouteRegistration {
  kind: RouteKind
  path: string
  handler: (req: DshRequest, res: DshResponse) => void | Promise<void>
}

export interface DshRequest {
  method: string
  url: string | undefined
  headers: Record<string, string | string[] | undefined>
}

export interface DshResponse {
  writeHead: (status: number, headers?: Record<string, string>) => void
  end: (data?: string | Buffer) => void
}

// ─── Cordis context ────────────────────────────────────────────────

export interface DshLogger {
  info: (...args: unknown[]) => void
  warn: (...args: unknown[]) => void
  error: (...args: unknown[]) => void
  debug: (...args: unknown[]) => void
}

export interface SessionService {
  list(): DshSession[]
  scope(sessionId: string): string | undefined
  sessionOf(scope: string): SessionHandle | undefined
  fork(opts: { sessionId: string; atSeq?: number; increaseTitle?: boolean }): Promise<string>
  create(opts: { cwd?: string } | { workspaceId?: string }): Promise<string>
  open(sessionId: string): void
}

export interface SessionHandle {
  readonly id: string
  readonly title: string | undefined
  readonly cwd: string | null
  prompt(messages: Array<{ type: string; text?: string }>, mode: string): Promise<PromptResult>
  subscribe(fn: (snapshot: SessionStateSnapshot) => void): () => void
  getSnapshot(): SessionStateSnapshot
  /** Called by the streaming pipeline to push live-reply state. */
  updateState(running: boolean, text: string): void
}

export interface WorkspaceService {
  list: { getSnapshot(): WorkspaceListSnapshot; subscribe(fn: (s: WorkspaceListSnapshot) => void): () => void }
}

export interface WebServerService {
  register(route: RouteRegistration): void
}

export interface CordisContext {
  webServer: WebServerService
  sessions: SessionService
  workspaces: WorkspaceService
  logger: DshLogger
  effect(fn: () => (() => void) | void, name: string): void
  on(event: string, handler: (...args: unknown[]) => void): void
  emit(event: string, ...args: unknown[]): void
  dispose(): void
}

// ─── Plugin descriptor ────────────────────────────────────────────

export interface DshPluginConfig {
  dataFile?: string
  autoProjection?: boolean
  projectionWorkspaceTitle?: string
  trustedHosts?: string[]
  [key: string]: unknown
}

export interface DshPluginModule {
  name: string
  inject: string[]
  apply: (ctx: CordisContext, config: DshPluginConfig) => void
}

export interface DshClientModule {
  inject: string[]
  apply: (ctx: unknown) => void
}

export interface DshPluginDescriptor {
  name: string
  version: string
  main: string
  inject: string[]
  config: DshPluginConfig
  clientModulePath?: string
  packageDir: string
}
