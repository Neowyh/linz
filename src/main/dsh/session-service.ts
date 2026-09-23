import { v4 as uuidv4 } from 'uuid'
import type {
  DshSession,
  SessionService,
  SessionHandle,
  SessionListSnapshot,
  SessionListItem
} from './types'
import type { StreamRunner } from './session-handle'
import { SessionHandleImpl } from './session-handle'
import { buildSessionFromConversation } from './session-event-builder'
import { getConversationsRepo, getMessagesRepo } from '../database'

interface SessionServiceDeps {
  emit: (event: string, ...args: unknown[]) => void
  runStream: StreamRunner
}

/**
 * Implements `ctx.sessions` for the DSH Cordis shim.
 *
 * Maps AeroMind conversations to DSH sessions. The `list()` method returns
 * full session objects with event streams (built from DB messages). Lifecycle
 * methods (fork/create/open) operate on the conversations table and emit
 * `session/created` events so plugins can project new sessions.
 */
export class SessionServiceImpl implements SessionService {
  private readonly handles = new Map<string, SessionHandleImpl>()
  private readonly deps: SessionServiceDeps

  constructor(deps: SessionServiceDeps) {
    this.deps = deps
  }

  /**
   * Returns all conversations as DSH session objects with full event streams.
   * Called once at plugin startup for initial projection replay.
   */
  list(): DshSession[] {
    const repo = getConversationsRepo()
    const conversations = repo.list(9999)
    const sessions: DshSession[] = []
    for (const conv of conversations) {
      const session = buildSessionFromConversation(conv.id)
      if (session) sessions.push(session)
    }
    return sessions
  }

  /**
   * Returns a snapshot of all conversations in the client-side reactive format.
   */
  getListSnapshot(): SessionListSnapshot {
    const repo = getConversationsRepo()
    const conversations = repo.list(9999)
    const ids: string[] = []
    const byId: Record<string, SessionListItem> = {}
    for (const conv of conversations) {
      ids.push(conv.id)
      byId[conv.id] = {
        id: conv.id,
        displayTitle: conv.title ?? '新对话',
        cwd: conv.cwd ?? null,
        parentId: conv.parent_conversation_id ?? null
      }
    }
    return { ids, byId }
  }

  scope(sessionId: string): string | undefined {
    const conv = getConversationsRepo().getById(sessionId)
    return conv ? sessionId : undefined
  }

  sessionOf(scope: string): SessionHandle | undefined {
    // Return cached handle if exists
    const cached = this.handles.get(scope)
    if (cached) return cached

    const conv = getConversationsRepo().getById(scope)
    if (!conv) return undefined

    const handle = new SessionHandleImpl(
      scope,
      conv.title ?? undefined,
      conv.cwd ?? null,
      this.deps.runStream
    )
    this.handles.set(scope, handle)
    return handle
  }

  async fork(opts: {
    sessionId: string
    atSeq?: number
    increaseTitle?: boolean
  }): Promise<string> {
    const convRepo = getConversationsRepo()
    const msgRepo = getMessagesRepo()

    const srcConv = convRepo.getById(opts.sessionId)
    if (!srcConv) throw new Error('源会话不存在')

    const messages = msgRepo.listByConversation(opts.sessionId)

    // Determine fork point: map event seq → message index
    let forkMessageIndex = messages.length - 1
    if (typeof opts.atSeq === 'number' && opts.atSeq >= 0) {
      forkMessageIndex = this.findMessageIndexAtSeq(messages, opts.atSeq)
    }

    const copiedMessages = messages.slice(0, forkMessageIndex + 1)

    // Generate new conversation with fork metadata via the repo
    let title: string | undefined
    if (opts.increaseTitle && srcConv.title) {
      title = `${srcConv.title} 分支`
    }

    const newConv = convRepo.fork(
      opts.sessionId,
      msgRepo,
      title,
      copiedMessages[copiedMessages.length - 1]?.id
    )

    // Emit session/created so plugins project the forked session
    const session = buildSessionFromConversation(newConv.id)
    if (session) {
      this.deps.emit('session/created', session)
    }

    return newConv.id
  }

  async create(opts: { cwd?: string } | { workspaceId?: string }): Promise<string> {
    const convRepo = getConversationsRepo()
    const newId = uuidv4()
    const cwd = 'cwd' in opts ? opts.cwd : undefined

    convRepo.create(newId, '新对话', cwd ? { cwd } : undefined)

    // Emit session/created
    const session = buildSessionFromConversation(newId)
    if (session) {
      this.deps.emit('session/created', session)
    }

    return newId
  }

  open(sessionId: string): void {
    // In the server context, open() is a no-op — the client bridge handles
    // the actual UI switch via IPC. Other plugins may override this.
    const conv = getConversationsRepo().getById(sessionId)
    if (!conv) throw new Error('会话不存在')
  }

  /**
   * Given an event seq number, find the message index that generated that event.
   * User messages generate 1 event; agent messages generate (toolCalls*2 + 2) events.
   */
  private findMessageIndexAtSeq(
    messages: Array<{ role: string; tool_calls: string | null }>,
    atSeq: number
  ): number {
    let seq = 0
    for (let i = 0; i < messages.length; i++) {
      const msg = messages[i]
      let eventsForThisMsg: number
      if (msg.role === 'user') {
        eventsForThisMsg = 1
      } else {
        let toolCallCount = 0
        if (msg.tool_calls) {
          try {
            const parsed = JSON.parse(msg.tool_calls)
            toolCallCount = Array.isArray(parsed) ? parsed.length : 0
          } catch {
            // Malformed JSON
          }
        }
        eventsForThisMsg = toolCallCount * 2 + 2
      }

      if (seq + eventsForThisMsg > atSeq) {
        return i
      }
      seq += eventsForThisMsg
    }
    return messages.length - 1
  }
}
