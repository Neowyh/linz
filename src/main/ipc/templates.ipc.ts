import { ipcMain, BrowserWindow } from 'electron'
import { getDatabase, debounceSave, type Template } from '../database'
import { v4 as uuidv4 } from 'uuid'

function rowToTemplate(row: any[]): Template {
  return {
    id: row[0] as string,
    name: row[1] as string,
    category: row[2] as string,
    description: row[3] as string | null,
    prompt_template: row[4] as string,
    agents: row[5] as string,
    input_params: row[6] as string,
    output_format: row[7] as string,
    is_builtin: row[8] as number,
    is_custom: row[9] as number,
    usage_count: row[10] as number,
    rating: row[11] as number,
    created_at: row[12] as string
  }
}

export function registerTemplatesIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle('template:list', async (_event, category?: string) => {
    const db = getDatabase()
    if (category && category !== '全部') {
      const results = db.exec('SELECT * FROM templates WHERE category = ? ORDER BY usage_count DESC', [category])
      if (!results[0]) return []
      return results[0].values.map(rowToTemplate)
    }
    const results = db.exec('SELECT * FROM templates ORDER BY usage_count DESC')
    if (!results[0]) return []
    return results[0].values.map(rowToTemplate)
  })

  ipcMain.handle('template:get', async (_event, id: string) => {
    const db = getDatabase()
    const results = db.exec('SELECT * FROM templates WHERE id = ?', [id])
    if (!results[0] || !results[0].values[0]) return null
    return rowToTemplate(results[0].values[0])
  })

  ipcMain.handle('template:use', async (_event, id: string) => {
    const db = getDatabase()
    db.run('UPDATE templates SET usage_count = usage_count + 1 WHERE id = ?', [id])
    debounceSave()
    const results = db.exec('SELECT * FROM templates WHERE id = ?', [id])
    if (!results[0] || !results[0].values[0]) return null
    return rowToTemplate(results[0].values[0])
  })

  ipcMain.handle('template:categories', async () => {
    const db = getDatabase()
    const results = db.exec('SELECT DISTINCT category FROM templates')
    if (!results[0]) return ['全部']
    return ['全部', ...results[0].values.map((r) => r[0] as string)]
  })

  ipcMain.handle('template:create', async (_event, params: {
    name: string
    description?: string
    category: string
    promptTemplate: string
    agentType?: string[]
  }) => {
    const db = getDatabase()
    const id = `template-custom-${uuidv4()}`
    const agents = JSON.stringify(params.agentType || [])
    // Parse {{variable}} placeholders from promptTemplate into input_params
    const varMatches = params.promptTemplate.match(/\{\{(\w+)\}\}/g) || []
    const inputParams = JSON.stringify(
      varMatches.map((m: string) => {
        const key = m.replace(/\{\{|\}\}/g, '')
        return { key, label: key, default: '' }
      })
    )

    db.run(
      `INSERT INTO templates (id, name, category, description, prompt_template, agents, input_params, is_builtin, is_custom, usage_count, rating)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, 1, 0, 0)`,
      [id, params.name, params.category, params.description || null, params.promptTemplate, agents, inputParams]
    )
    debounceSave()

    const results = db.exec('SELECT * FROM templates WHERE id = ?', [id])
    if (!results[0] || !results[0].values[0]) return null
    return rowToTemplate(results[0].values[0])
  })

  ipcMain.handle('template:update', async (_event, id: string, updates: {
    name?: string
    description?: string
    category?: string
    promptTemplate?: string
    agentType?: string[]
  }) => {
    const db = getDatabase()
    // Only allow updating custom templates
    const existing = db.exec('SELECT is_builtin FROM templates WHERE id = ?', [id])
    if (!existing[0] || !existing[0].values[0]) {
      return { success: false, error: '模板不存在' }
    }
    if ((existing[0].values[0][0] as number) === 1) {
      return { success: false, error: '内置模板不可修改' }
    }

    const setClauses: string[] = []
    const values: any[] = []

    if (updates.name !== undefined) { setClauses.push('name = ?'); values.push(updates.name) }
    if (updates.description !== undefined) { setClauses.push('description = ?'); values.push(updates.description) }
    if (updates.category !== undefined) { setClauses.push('category = ?'); values.push(updates.category) }
    if (updates.promptTemplate !== undefined) {
      setClauses.push('prompt_template = ?')
      values.push(updates.promptTemplate)
      // Re-derive input_params from template variables
      const varMatches = updates.promptTemplate.match(/\{\{(\w+)\}\}/g) || []
      const inputParams = JSON.stringify(
        varMatches.map((m: string) => {
          const key = m.replace(/\{\{|\}\}/g, '')
          return { key, label: key, default: '' }
        })
      )
      setClauses.push('input_params = ?')
      values.push(inputParams)
    }
    if (updates.agentType !== undefined) { setClauses.push('agents = ?'); values.push(JSON.stringify(updates.agentType)) }

    if (setClauses.length === 0) return { success: true }

    values.push(id)
    db.run(`UPDATE templates SET ${setClauses.join(', ')} WHERE id = ?`, values)
    debounceSave()
    return { success: true }
  })

  ipcMain.handle('template:delete', async (_event, id: string) => {
    const db = getDatabase()
    const existing = db.exec('SELECT is_builtin FROM templates WHERE id = ?', [id])
    if (!existing[0] || !existing[0].values[0]) {
      return { success: false, error: '模板不存在' }
    }
    if ((existing[0].values[0][0] as number) === 1) {
      return { success: false, error: '内置模板不可删除' }
    }

    db.run('DELETE FROM templates WHERE id = ?', [id])
    debounceSave()
    return { success: true }
  })
}
