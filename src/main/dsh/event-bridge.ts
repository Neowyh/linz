import type { DshSession } from './types'
import type { ToolCallData } from '../agents/base.agent'
import {
  buildUserMessageEvent,
  buildToolCallEvent,
  buildToolResultEvent,
  buildAssistantMessageEvent,
  buildTurnEndEvent,
  buildSessionFromConversation
} from './session-event-builder'
import { getConversationsRepo } from '../database'

interface SessionEventState {
  seq: number
  turn: number
  step: number
  textAccumulator: string
}

/**
 * Converts AeroMind's streaming pipeline into DSH session events.
 *
 * The bridge is called from the shared `runStream` function (used by both
 * `chat:sendMessage` and `dsh:prompt`). It maintains per-conversation
 * seq/turn/step counters and emits `session/event` through the Cordis
 * context so plugins like Synapse can project committed events.
 *
 * The text passed to `onAgentText` must already be stripped of step/panel
 * markers (handled by StepMarkerStream/PanelMarkerStream in the streaming
 * pipeline) and `<<<AGENT_MSG>>>` blocks (stripped on completion).
 */
export class EventBridge {
  private readonly states = new Map<string, SessionEventState>()

  constructor(private readonly emitFn: (event: string, ...args: unknown[]) => void) {}

  /**
   * Called when a new conversation is created. Emits `session/created`
   * so plugins can project the new session.
   */
  onConversationCreated(conversationId: string): void {
    const session = buildSessionFromConversation(conversationId)
    if (session) {
      this.emitFn('session/created', session)
    }
  }

  /**
   * Called when a user message is persisted. Emits a `user/message` event
   * and starts a new turn.
   */
  onUserMessage(conversationId: string, content: string): void {
    const state = this.getState(conversationId)
    state.seq++
    state.turn++
    state.step = 0

    const event = buildUserMessageEvent(state.seq, content, new Date().toISOString())
    this.emitFn('session/event', this.buildLightweightSession(conversationId), event)
  }

  /**
   * Called with clean (marker-stripped) agent text deltas. Accumulates
   * text for the eventual `assistant/message` event.
   */
  onAgentText(conversationId: string, text: string): void {
    const state = this.getState(conversationId)
    state.textAccumulator += text
  }

  /**
   * Called when a tool call completes. Emits `tool/call` + `tool/result`
   * events folded into the current turn/step.
   */
  onToolCall(conversationId: string, toolCall: ToolCallData): void {
    if (toolCall.isComplete === false) return // Still running — don't project yet

    const state = this.getState(conversationId)
    const callId = toolCall.toolCallId ?? `tc-${state.seq + 1}`
    const now = new Date().toISOString()
    const session = this.buildLightweightSession(conversationId)

    // tool/call
    state.seq++; state.step++
    this.emitFn(
      'session/event',
      session,
      buildToolCallEvent(state.seq, state.turn, state.step, callId, toolCall.tool, toolCall.input, now)
    )

    // tool/result
    state.seq++; state.step++
    this.emitFn(
      'session/event',
      session,
      buildToolResultEvent(state.seq, state.turn, state.step, callId, toolCall.output, now)
    )
  }

  /**
   * Called when an agent message stream completes. Emits `assistant/message`
   * (with accumulated text) then `turn/end`.
   */
  onTurnEnd(conversationId: string, _messageId: string): void {
    const state = this.getState(conversationId)
    const now = new Date().toISOString()
    const session = this.buildLightweightSession(conversationId)

    // assistant/message
    state.seq++; state.step++
    this.emitFn(
      'session/event',
      session,
      buildAssistantMessageEvent(state.seq, state.turn, state.step, state.textAccumulator, now)
    )

    // turn/end
    state.seq++; state.step++
    this.emitFn(
      'session/event',
      session,
      buildTurnEndEvent(state.seq, state.turn, state.step, now)
    )

    // Reset for next turn
    state.textAccumulator = ''
  }

  /**
   * Called when a conversation title changes. Emits a `session/title` event.
   */
  onTitleChanged(conversationId: string, title: string): void {
    const state = this.getState(conversationId)
    state.seq++
    this.emitFn(
      'session/event',
      this.buildLightweightSession(conversationId),
      {
        type: 'session/title',
        seq: state.seq,
        time: new Date().toISOString(),
        data: { title }
      }
    )
  }

  /**
   * Get or create per-conversation event state. For existing conversations,
   * the seq/turn counters are initialized from the DB's event history so
   * live events continue from the correct sequence numbers.
   */
  private getState(conversationId: string): SessionEventState {
    let state = this.states.get(conversationId)
    if (!state) {
      const session = buildSessionFromConversation(conversationId)
      let seq = 0
      let turn = 0
      if (session) {
        seq = session.events.length
        for (const e of session.events) {
          if (typeof e.data.turn === 'number' && e.data.turn > turn) {
            turn = e.data.turn
          }
        }
      }
      state = { seq, turn, step: 0, textAccumulator: '' }
      this.states.set(conversationId, state)
    }
    return state
  }

  /**
   * Build a lightweight session object (header only, no events) for
   * event emission. This avoids rebuilding the full event history on
   * every emitted event.
   */
  private buildLightweightSession(conversationId: string): DshSession {
    const conv = getConversationsRepo().getById(conversationId)
    if (!conv) {
      return {
        id: conversationId,
        title: undefined,
        firstLiveSeq: 0,
        header: {},
        events: []
      }
    }
    const cwd = conv.cwd ?? undefined
    const parentSession = conv.parent_conversation_id ?? undefined
    const seedLength = conv.seed_length ?? 0
    return {
      id: conv.id,
      title: conv.title ?? undefined,
      firstLiveSeq: seedLength,
      header: {
        meta: cwd ? { cwd } : undefined,
        cwd,
        parentSession,
        seedLength: seedLength || undefined
      },
      events: []
    }
  }
}
