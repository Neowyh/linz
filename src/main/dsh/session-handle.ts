import type { PromptResult, SessionHandle, SessionStateSnapshot } from './types'

/**
 * Callback that runs the full streaming pipeline for a conversation.
 *
 * Persist the user message, invoke the agent engine, forward StreamChunks
 * to the renderer, emit DSH events through the EventBridge, and persist
 * the final agent message. The SessionHandle itself only tracks running/text
 * state for subscribers — all the heavy lifting lives in the StreamRunner
 * so the same code path serves both `chat:sendMessage` and `dsh:prompt`.
 */
export type StreamRunner = (conversationId: string, text: string) => Promise<void>

export class SessionHandleImpl implements SessionHandle {
  private running = false
  private text = ''
  private readonly subscribers = new Set<(snapshot: SessionStateSnapshot) => void>()

  constructor(
    public readonly id: string,
    public readonly title: string | undefined,
    public readonly cwd: string | null,
    private readonly runStream: StreamRunner
  ) {}

  async prompt(
    messages: Array<{ type: string; text?: string }>,
    _mode: string
  ): Promise<PromptResult> {
    const text = messages.find((m) => m.type === 'text')?.text ?? ''
    if (!text.trim()) return { ok: false, error: { message: '消息不能为空' } }

    // Mark running immediately so the map shows a live-reply indicator.
    this.running = true
    this.text = ''
    this.notify()

    // Fire-and-forget: the stream runs in the background, updating state
    // and emitting DSH events. The 'queue' mode returns as soon as the
    // message is accepted, not when the response completes.
    this.runStream(this.id, text)
      .then(() => {
        this.updateState(false, '')
      })
      .catch(() => {
        this.updateState(false, '')
      })

    return { ok: true }
  }

  /** Called by the streaming pipeline to push live-reply text. */
  updateState(running: boolean, text: string): void {
    this.running = running
    this.text = text
    this.notify()
  }

  subscribe(fn: (snapshot: SessionStateSnapshot) => void): () => void {
    this.subscribers.add(fn)
    return () => {
      this.subscribers.delete(fn)
    }
  }

  getSnapshot(): SessionStateSnapshot {
    return {
      partial: {
        blocks: this.text ? [{ kind: 'text', text: this.text }] : []
      },
      running: this.running,
      chat: { nodes: new Map() }
    }
  }

  private notify(): void {
    const snapshot = this.getSnapshot()
    for (const fn of this.subscribers) {
      try {
        fn(snapshot)
      } catch {
        // Subscriber errors must not break the notification loop.
      }
    }
  }
}
