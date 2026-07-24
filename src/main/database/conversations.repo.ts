import type { Database as SqlJsDatabase } from 'sql.js'
import type { Conversation } from './index'

export class ConversationsRepo {
  constructor(
    private db: SqlJsDatabase,
    private notifySave: () => void
  ) {}

  create(id: string, title?: string): Conversation {
    this.db.run('INSERT INTO conversations (id, title) VALUES (?, ?)', [id, title || '新对话'])
    this.notifySave()
    return this.getById(id)!
  }

  list(limit = 50): Conversation[] {
    const results = this.db.exec('SELECT * FROM conversations ORDER BY updated_at DESC LIMIT ?', [limit])
    if (!results[0]) return []
    return results[0].values.map((row) => ({
      id: row[0] as string,
      title: row[1] as string | null,
      created_at: row[2] as string,
      updated_at: row[3] as string,
      task_type: row[4] as string | null,
      agents_used: row[5] as string,
      total_tokens: row[6] as number,
      status: row[7] as string
    }))
  }

  getById(id: string): Conversation | undefined {
    const results = this.db.exec('SELECT * FROM conversations WHERE id = ?', [id])
    if (!results[0] || !results[0].values[0]) return undefined
    const row = results[0].values[0]
    return {
      id: row[0] as string,
      title: row[1] as string | null,
      created_at: row[2] as string,
      updated_at: row[3] as string,
      task_type: row[4] as string | null,
      agents_used: row[5] as string,
      total_tokens: row[6] as number,
      status: row[7] as string
    }
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
}
