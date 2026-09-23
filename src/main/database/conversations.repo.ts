import type { Database as SqlJsDatabase } from 'sql.js'
import type { Conversation } from './index'
import { v4 as uuidv4 } from 'uuid'
import type { MessagesRepo } from './messages.repo'

const SELECT_COLUMNS =
  'id, title, created_at, updated_at, task_type, agents_used, total_tokens, status, parent_conversation_id, fork_at_message_id, seed_length, cwd'

function mapRow(row: unknown[]): Conversation {
  return {
    id: row[0] as string,
    title: row[1] as string | null,
    created_at: row[2] as string,
    updated_at: row[3] as string,
    task_type: row[4] as string | null,
    agents_used: row[5] as string,
    total_tokens: row[6] as number,
    status: row[7] as string,
    parent_conversation_id: (row[8] as string | null) ?? null,
    fork_at_message_id: (row[9] as string | null) ?? null,
    seed_length: (row[10] as number) ?? 0,
    cwd: (row[11] as string | null) ?? null
  }
}

export interface CreateOptions {
  parentId?: string
  forkAtMessageId?: string
  seedLength?: number
  cwd?: string
}

export class ConversationsRepo {
  constructor(
    private db: SqlJsDatabase,
    private notifySave: () => void
  ) {}

  create(id: string, title?: string, options?: CreateOptions): Conversation {
    if (options?.parentId) {
      this.db.run(
        `INSERT INTO conversations (id, title, parent_conversation_id, fork_at_message_id, seed_length, cwd) VALUES (?, ?, ?, ?, ?, ?)`,
        [id, title || '新对话', options.parentId, options.forkAtMessageId ?? null, options.seedLength ?? 0, options.cwd ?? null]
      )
    } else if (options?.cwd) {
      this.db.run(
        `INSERT INTO conversations (id, title, cwd) VALUES (?, ?, ?)`,
        [id, title || '新对话', options.cwd]
      )
    } else {
      this.db.run('INSERT INTO conversations (id, title) VALUES (?, ?)', [id, title || '新对话'])
    }
    this.notifySave()
    return this.getById(id)!
  }

  list(limit = 50): Conversation[] {
    const results = this.db.exec(
      `SELECT ${SELECT_COLUMNS} FROM conversations ORDER BY updated_at DESC LIMIT ?`,
      [limit]
    )
    if (!results[0]) return []
    return results[0].values.map(mapRow)
  }

  getById(id: string): Conversation | undefined {
    const results = this.db.exec(
      `SELECT ${SELECT_COLUMNS} FROM conversations WHERE id = ?`,
      [id]
    )
    if (!results[0] || !results[0].values[0]) return undefined
    return mapRow(results[0].values[0])
  }

  updateTitle(id: string, title: string): void {
    this.db.run('UPDATE conversations SET title = ?, updated_at = datetime("now") WHERE id = ?', [title, id])
    this.notifySave()
  }

  updateTokens(id: string, tokens: number): void {
    this.db.run('UPDATE conversations SET total_tokens = ?, updated_at = datetime("now") WHERE id = ?', [tokens, id])
    this.notifySave()
  }

  updateStatus(id: string, status: string): void {
    this.db.run('UPDATE conversations SET status = ?, updated_at = datetime("now") WHERE id = ?', [status, id])
    this.notifySave()
  }

  touch(id: string): void {
    this.db.run('UPDATE conversations SET updated_at = datetime("now") WHERE id = ?', [id])
    this.notifySave()
  }

  delete(id: string): void {
    this.db.run('DELETE FROM messages WHERE conversation_id = ?', [id])
    this.db.run('DELETE FROM conversations WHERE id = ?', [id])
    this.notifySave()
  }

  /**
   * Fork a conversation: create a new conversation with fork metadata,
   * copy messages from the source up to (and including) atMessageId,
   * preserving insertion order and JSON columns verbatim.
   */
  fork(srcId: string, msgRepo: MessagesRepo, title?: string, atMessageId?: string): Conversation {
    const srcConv = this.getById(srcId)
    if (!srcConv) throw new Error('Source conversation not found')

    const messages = msgRepo.listByConversation(srcId)
    let copiedMessages = messages
    if (atMessageId) {
      const idx = messages.findIndex((m) => m.id === atMessageId)
      if (idx >= 0) copiedMessages = messages.slice(0, idx + 1)
    }

    const newId = uuidv4()
    let forkTitle = title ?? `${srcConv.title ?? '新对话'} 分支`

    this.create(newId, forkTitle, {
      parentId: srcId,
      forkAtMessageId: atMessageId ?? copiedMessages[copiedMessages.length - 1]?.id ?? null,
      seedLength: copiedMessages.length,
      cwd: srcConv.cwd ?? undefined
    })

    // Copy messages in insertion order (rowid ASC)
    let totalTokens = 0
    for (const msg of copiedMessages) {
      msgRepo.insert({
        id: uuidv4(),
        conversation_id: newId,
        role: msg.role,
        agent_type: msg.agent_type,
        content: msg.content,
        tokens: msg.tokens,
        tool_calls: msg.tool_calls,
        skill_triggers: msg.skill_triggers
      })
      totalTokens += msg.tokens
    }
    if (totalTokens > 0) this.updateTokens(newId, totalTokens)

    return this.getById(newId)!
  }
}
