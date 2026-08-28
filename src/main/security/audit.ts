// 审计日志：记录每个过门的工具调用（含决策与耗时），写入 security_audit 表。

import { getDatabase, debounceSave } from '../database'

export type AuditDecision =
  | 'allow' // 策略直接放行（只读或已配置允许）
  | 'remembered' // 命中"始终允许"记忆
  | 'approve' // 用户批准
  | 'deny' // 用户拒绝 / 策略禁用
  | 'timeout' // 超时自动拒绝

export interface AuditEntry {
  conversationId?: string
  agentType?: string
  toolName: string
  argsSummary: string
  risk: string
  decision: AuditDecision
  source: string
  durationMs: number
}

export function writeAudit(entry: AuditEntry): void {
  try {
    const db = getDatabase()
    db.run(
      `INSERT INTO security_audit
        (ts, conversation_id, agent_type, tool_name, args_summary, risk, decision, source, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        Date.now(),
        entry.conversationId || null,
        entry.agentType || null,
        entry.toolName,
        entry.argsSummary || '',
        entry.risk,
        entry.decision,
        entry.source,
        entry.durationMs
      ]
    )
    debounceSave()
  } catch (err: any) {
    console.warn('[Audit] writeAudit failed:', err?.message || err)
  }
}

export interface AuditRow {
  id: number
  ts: number
  conversation_id: string | null
  agent_type: string | null
  tool_name: string
  args_summary: string
  risk: string
  decision: string
  source: string
  duration_ms: number
}

export function listAudit(limit = 200): AuditRow[] {
  try {
    const db = getDatabase()
    const res = db.exec(
      `SELECT id, ts, conversation_id, agent_type, tool_name, args_summary, risk, decision, source, duration_ms
       FROM security_audit ORDER BY id DESC LIMIT ?`,
      [limit]
    )
    const rows = res[0]?.values || []
    return rows.map((r) => ({
      id: r[0] as number,
      ts: r[1] as number,
      conversation_id: r[2] as string | null,
      agent_type: r[3] as string | null,
      tool_name: r[4] as string,
      args_summary: r[5] as string,
      risk: r[6] as string,
      decision: r[7] as string,
      source: r[8] as string,
      duration_ms: r[9] as number
    }))
  } catch {
    return []
  }
}

export function clearAudit(): boolean {
  try {
    const db = getDatabase()
    db.run('DELETE FROM security_audit')
    debounceSave()
    return true
  } catch {
    return false
  }
}
