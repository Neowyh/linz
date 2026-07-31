import type { Database as SqlJsDatabase } from 'sql.js'
import type { Message } from './index'

export class MessagesRepo {
  constructor(
    private db: SqlJsDatabase,
    private notifySave: () => void
  ) {}

  insert(msg: { id: string; conversation_id: string; role: string; agent_type: string | null; content: string; tokens: number; tool_calls?: string | null }): void {
    this.db.run(
      'INSERT INTO messages (id, conversation_id, role, agent_type, content, tokens, tool_calls) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [msg.id, msg.conversation_id, msg.role, msg.agent_type, msg.content, msg.tokens, msg.tool_calls ?? null]
    )
    this.notifySave()
  }

  listByConversation(conversationId: string): Message[] {
    // ORDER BY rowid 保证插入顺序，避免 created_at（秒精度）相同时顺序不定
    // 否则 history.slice(0, -1) 可能排除错误的消息，导致 agent 丢失上下文
    // 显式列名：tool_calls 由 ALTER TABLE 追加在末尾，不能用 SELECT * 按位置映射
    const results = this.db.exec(
      'SELECT id, conversation_id, role, agent_type, content, tokens, created_at, tool_calls FROM messages WHERE conversation_id = ? ORDER BY rowid ASC',
      [conversationId]
    )
    if (!results[0]) return []
    return results[0].values.map((row) => ({
      id: row[0] as string,
      conversation_id: row[1] as string,
      role: row[2] as string,
      agent_type: row[3] as string | null,
      content: row[4] as string,
      tokens: row[5] as number,
      created_at: row[6] as string,
      tool_calls: row[7] as string | null
    }))
  }

  updateContent(id: string, content: string, tokens: number): void {
    this.db.run('UPDATE messages SET content = ?, tokens = ? WHERE id = ?', [content, tokens, id])
    this.notifySave()
  }

  deleteByConversation(conversationId: string): void {
    this.db.run('DELETE FROM messages WHERE conversation_id = ?', [conversationId])
    this.notifySave()
  }
}
