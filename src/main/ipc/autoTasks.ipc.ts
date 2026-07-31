import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase, debounceSave, type AutoTask } from '../database'
import { startJob, stopJob, runTaskManually } from '../scheduler'
import { v4 as uuidv4 } from 'uuid'

function rowToAutoTask(row: any[]): AutoTask {
  return {
    id: row[0] as string,
    name: row[1] as string,
    description: row[2] as string | null,
    cron_expression: row[3] as string,
    agents: row[4] as string,
    is_active: row[5] as number,
    last_run: row[6] as string | null,
    next_run: row[7] as string | null,
    run_count: row[8] as number,
    result_action: row[9] as string,
    created_at: row[10] as string
  }
}

export function registerAutoTasksIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle('autoTask:list', async () => {
    const db = getDatabase()
    const results = db.exec('SELECT * FROM auto_tasks ORDER BY created_at DESC')
    if (!results[0]) return []
    return results[0].values.map(rowToAutoTask)
  })

  ipcMain.handle('autoTask:create', async (_event, task: { name: string; description?: string; cron_expression: string; agents?: string; result_action?: string }) => {
    const db = getDatabase()
    const id = uuidv4()
    db.run(
      `INSERT INTO auto_tasks (id, name, description, cron_expression, agents, result_action) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, task.name, task.description || '', task.cron_expression, task.agents || '["orchestrator"]', task.result_action || 'notify']
    )
    debounceSave()

    // 启动调度
    startJob(id, task.name, task.cron_expression, task.description || '', task.agents || '["orchestrator"]')

    const result = db.exec('SELECT * FROM auto_tasks WHERE id = ?', [id])
    if (!result[0] || !result[0].values[0]) return null
    return rowToAutoTask(result[0].values[0])
  })

  ipcMain.handle('autoTask:update', async (_event, id: string, updates: Partial<AutoTask>) => {
    const db = getDatabase()
    const fields: string[] = []
    const values: any[] = []
    if (updates.name !== undefined) { fields.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { fields.push('description = ?'); values.push(updates.description) }
    if (updates.cron_expression !== undefined) { fields.push('cron_expression = ?'); values.push(updates.cron_expression) }
    if (updates.agents !== undefined) { fields.push('agents = ?'); values.push(updates.agents) }
    if (updates.is_active !== undefined) { fields.push('is_active = ?'); values.push(updates.is_active) }
    if (updates.result_action !== undefined) { fields.push('result_action = ?'); values.push(updates.result_action) }
    if (fields.length === 0) return { success: false }
    values.push(id)
    db.run(`UPDATE auto_tasks SET ${fields.join(', ')} WHERE id = ?`, values)
    debounceSave()

    // 如果 cron 表达式变了，重新启动调度
    if (updates.cron_expression !== undefined || updates.is_active !== undefined) {
      stopJob(id)
      const row = db.exec('SELECT name, cron_expression, is_active, description, agents FROM auto_tasks WHERE id = ?', [id])
      if (row[0]?.values[0]) {
        const [name, cronExpr, isActive, description, agents] = row[0].values[0] as [string, string, number, string, string]
        if (isActive === 1) {
          startJob(id, name, cronExpr, description, agents)
        }
      }
    }

    return { success: true }
  })

  ipcMain.handle('autoTask:delete', async (_event, id: string) => {
    const db = getDatabase()
    stopJob(id)
    db.run('DELETE FROM auto_tasks WHERE id = ?', [id])
    debounceSave()
    return { success: true }
  })

  ipcMain.handle('autoTask:toggle', async (_event, id: string) => {
    const db = getDatabase()
    db.run('UPDATE auto_tasks SET is_active = CASE WHEN is_active = 1 THEN 0 ELSE 1 END WHERE id = ?', [id])
    debounceSave()

    // 读取当前状态，启动或停止调度
    const row = db.exec('SELECT name, cron_expression, is_active, description, agents FROM auto_tasks WHERE id = ?', [id])
    if (row[0]?.values[0]) {
      const [name, cronExpr, isActive, description, agents] = row[0].values[0] as [string, string, number, string, string]
      if (isActive === 1) {
        startJob(id, name, cronExpr, description, agents)
      } else {
        stopJob(id)
      }
    }

    return { success: true }
  })

  // 测试运行：立即手动触发一次，不等 cron 到点
  ipcMain.handle('autoTask:test', async (_event, id: string) => {
    return runTaskManually(id)
  })
}
