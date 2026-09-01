import type { DshSession, SessionEvent, SessionEventContentBlock } from './types'
import { getConversationsRepo, getMessagesRepo } from '../database'

interface ToolCallEntry {
  tool: string
  input: string
  output: string
  toolCallId?: string
  isComplete?: boolean
}

/**
 * Convert AeroMind's conversation + messages into a DSH session object
 * with an ordered event stream.
 *
 * Each user message → `user/message` event (starts a new turn).
 * Each agent message → `tool/call` + `tool/result` pairs (folded from
 *   the `tool_calls` JSON column) then `assistant/message` then `turn/end`.
 *
 * Forks inherit `firstLiveSeq` = the event count of the first `seedLength`
 * messages, so projection skips events already represented by the parent node.
 */
export function buildSessionFromConversation(convId: string): DshSession | null {
  const convRepo = getConversationsRepo()
  const msgRepo = getMessagesRepo()
  const conv = convRepo.getById(convId)
  if (!conv) return null

  const messages = msgRepo.listByConversation(convId)
  const seedLength = conv.seed_length ?? 0

  let seq = 0
  let turn = 0
  let eventsBeforeSeed = 0
  const events: SessionEvent[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const isBeforeSeed = i < seedLength

    if (msg.role === 'user') {
      seq++
      events.push({
        type: 'user/message',
        seq,
        time: msg.created_at,
        data: { content: [{ type: 'text', text: msg.content }] }
      })
      turn++
      if (isBeforeSeed) eventsBeforeSeed = seq
    } else if (msg.role === 'agent' || msg.role === 'assistant') {
      let step = 0
      // Parse tool calls
      let toolCalls: ToolCallEntry[] = []
      if (msg.tool_calls) {
        try {
          const parsed = JSON.parse(msg.tool_calls)
          if (Array.isArray(parsed)) toolCalls = parsed
        } catch {
          // Malformed JSON — skip tool call projection
        }
      }

      for (const tc of toolCalls) {
        seq++; step++
        events.push({
          type: 'tool/call',
          seq,
          time: msg.created_at,
          data: {
            turn,
            step,
            callId: tc.toolCallId ?? `tc-${seq}`,
            name: tc.tool,
            arguments: tc.input
          }
        })
        seq++; step++
        const resultBlocks: SessionEventContentBlock[] = [
          { type: 'text', text: tc.output }
        ]
        events.push({
          type: 'tool/result',
          seq,
          time: msg.created_at,
          data: {
            turn,
            step,
            message: {
              source: { callId: tc.toolCallId ?? `tc-${seq - 1}` },
              content: resultBlocks
            }
          }
        })
      }

      // Assistant message
      seq++; step++
      events.push({
        type: 'assistant/message',
        seq,
        time: msg.created_at,
        data: {
          turn,
          step,
          message: { content: [{ type: 'text', text: msg.content }] }
        }
      })

      // Turn end
      seq++; step++
      events.push({
        type: 'turn/end',
        seq,
        time: msg.created_at,
        data: { turn, step, reason: { kind: 'normal' } }
      })
      if (isBeforeSeed) eventsBeforeSeed = seq
    }
  }

  const cwd = conv.cwd ?? undefined
  return {
    id: conv.id,
    title: conv.title ?? undefined,
    firstLiveSeq: eventsBeforeSeed,
    header: {
      meta: cwd ? { cwd } : undefined,
      cwd,
      parentSession: conv.parent_conversation_id ?? undefined,
      seedLength: seedLength || undefined
    },
    events
  }
}

/**
 * Build a single `user/message` event from a user message string.
 * Used by the EventBridge when a new user message is persisted.
 */
export function buildUserMessageEvent(seq: number, text: string, time: string): SessionEvent {
  return {
    type: 'user/message',
    seq,
    time,
    data: { content: [{ type: 'text', text }] }
  }
}

/**
 * Build a `tool/call` event from a StreamChunk tool call.
 */
export function buildToolCallEvent(
  seq: number,
  turn: number,
  step: number,
  callId: string,
  name: string,
  arguments_: string,
  time: string
): SessionEvent {
  return {
    type: 'tool/call',
    seq,
    time,
    data: { turn, step, callId, name, arguments: arguments_ }
  }
}

/**
 * Build a `tool/result` event.
 */
export function buildToolResultEvent(
  seq: number,
  turn: number,
  step: number,
  callId: string,
  result: string,
  time: string
): SessionEvent {
  return {
    type: 'tool/result',
    seq,
    time,
    data: {
      turn,
      step,
      message: { source: { callId }, content: [{ type: 'text', text: result }] }
    }
  }
}

/**
 * Build an `assistant/message` event from accumulated agent text.
 */
export function buildAssistantMessageEvent(
  seq: number,
  turn: number,
  step: number,
  text: string,
  time: string
): SessionEvent {
  return {
    type: 'assistant/message',
    seq,
    time,
    data: { turn, step, message: { content: [{ type: 'text', text }] } }
  }
}

/**
 * Build a `turn/end` event.
 */
export function buildTurnEndEvent(
  seq: number,
  turn: number,
  step: number,
  time: string,
  reasonKind = 'normal'
): SessionEvent {
  return {
    type: 'turn/end',
    seq,
    time,
    data: { turn, step, reason: { kind: reasonKind } }
  }
}

/**
 * Build a `session/title` event.
 */
export function buildSessionTitleEvent(seq: number, title: string, time: string): SessionEvent {
  return {
    type: 'session/title',
    seq,
    time,
    data: { title }
  }
}
