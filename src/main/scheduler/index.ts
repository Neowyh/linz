import cron from 'node-cron'
import type { ScheduledTask } from 'node-cron'
import { BrowserWindow, Notification } from 'electron'
import { getAgentEngine } from '../agents'
import { getDatabase, debounceSave } from '../database'
import { getMessagesRepo, getConversationsRepo } from '../database'
import { v4 as uuidv4 } from 'uuid'

interface ScheduledJob {
  taskId: string
  job: ScheduledTask
}

const activeJobs: Map<string, ScheduledJob> = new Map()
const runningTasks: Set<string> = new Set()
let mainWindowRef: BrowserWindow | null = null

export function setMainWindowForScheduler(mainWindow: BrowserWindow): void {
  mainWindowRef = mainWindow
}

// 启动所有活跃的自动任务
export function startAllSchedulers(): void {
  const db = getDatabase()
  const results = db.exec('SELECT id, name, cron_expression, is_active, description, agents FROM auto_tasks')
  if (!results[0]) return

  for (const row of results[0].values) {
    const [id, name, cronExpr, isActive, description, agents] = row as [string, string, string, number, string, string]
    if (isActive === 1 && cron.validate(cronExpr)) {
      startJob(id, name, cronExpr, description, agents)
    }
  }
}

// 停止所有调度器
export function stopAllSchedulers(): void {
  for (const [taskId, scheduled] of activeJobs) {
    scheduled.job.stop()
    activeJobs.delete(taskId)
  }
}

// 启动单个任务的 cron 调度
export function startJob(taskId: string, name: string, cronExpr: string, description: string, agentsStr: string): void {
  // 如果已经在运行，先停止
  stopJob(taskId)

  if (!cron.validate(cronExpr)) return

  const job = cron.schedule(cronExpr, async () => {
    await executeTask(taskId, name, description, agentsStr)
  })

  activeJobs.set(taskId, { taskId, job })

  // 更新 next_run
  try {
    const db = getDatabase()
    const nextDate = getNextRun(cronExpr)
    if (nextDate) {
      db.run('UPDATE auto_tasks SET next_run = ? WHERE id = ?', [nextDate, taskId])
      debounceSave()
    }
  } catch { /* ignore */ }
}

// 停止单个任务
export function stopJob(taskId: string): void {
  const scheduled = activeJobs.get(taskId)
  if (scheduled) {
    scheduled.job.stop()
    activeJobs.delete(taskId)
  }
}

// 手动触发一次任务执行（测试用），后台运行，结果照常走通知 + 会话持久化
export function runTaskManually(taskId: string): { success: boolean; message?: string } {
  if (runningTasks.has(taskId)) {
    return { success: false, message: '任务正在执行中，请稍候' }
  }
  const db = getDatabase()
  const row = db.exec('SELECT name, description, agents FROM auto_tasks WHERE id = ?', [taskId])
  if (!row[0]?.values[0]) {
    return { success: false, message: '任务不存在' }
  }
  const [name, description, agents] = row[0].values[0] as [string, string | null, string]
  void executeTask(taskId, name, description || '', agents)
  return { success: true }
}

// 执行任务
async function executeTask(taskId: string, name: string, description: string, agentsStr: string): Promise<void> {
  // 重入保护：同一任务不并发执行
  if (runningTasks.has(taskId)) return
  runningTasks.add(taskId)

  const db = getDatabase()

  // 更新运行状态
  db.run('UPDATE auto_tasks SET last_run = datetime("now"), run_count = run_count + 1 WHERE id = ?', [taskId])

  // 更新下次运行时间
  const taskRow = db.exec('SELECT cron_expression FROM auto_tasks WHERE id = ?', [taskId])
  if (taskRow[0]?.values[0]) {
    const nextDate = getNextRun(taskRow[0].values[0][0] as string)
    if (nextDate) {
      db.run('UPDATE auto_tasks SET next_run = ? WHERE id = ?', [nextDate, taskId])
    }
  }

  debounceSave()

  // 确保对话记录存在
  const convId = `auto_${taskId}`
  const convRepo = getConversationsRepo()
  let conv = convRepo.getById(convId)
  if (!conv) {
    convRepo.create(convId, `[自动] ${name}`)
  }

  try {
    const engine = getAgentEngine()
    if (!engine) {
      sendNotification(name, '任务执行失败：未配置 API Key')
      return
    }

    // 构建任务提示
    const prompt = `【自动任务】${name}\n\n${description}`

    // 执行 Agent，同时持久化消息到数据库
    const messagesRepo = getMessagesRepo()
    const userMsgId = uuidv4()
    messagesRepo.insert({
      id: userMsgId,
      conversation_id: convId,
      role: 'user',
      agent_type: null,
      content: prompt,
      tokens: 0
    })

    const agentMessages = new Map<string, { agentType: string; content: string }>()
    let result = ''

    for await (const chunk of engine.handleUserMessage(convId, prompt, new AbortController().signal)) {
      if (chunk.content) {
        result += chunk.content

        // 聚合 agent 消息
        const existing = agentMessages.get(chunk.messageId)
        if (existing) {
          existing.content += chunk.content
        } else {
          agentMessages.set(chunk.messageId, { agentType: chunk.agentType, content: chunk.content })
        }
      }

      // 流结束时持久化完整的 Agent 消息
      if (chunk.isComplete) {
        const msgData = agentMessages.get(chunk.messageId)
        if (msgData && msgData.content) {
          messagesRepo.insert({
            id: chunk.messageId,
            conversation_id: convId,
            role: 'agent',
            agent_type: msgData.agentType,
            content: msgData.content,
            tokens: Math.ceil(msgData.content.length / 4)
          })
          agentMessages.delete(chunk.messageId)
        }
      }
    }

    // 更新对话的 updated_at
    convRepo.touch(convId)

    // 发送通知
    const summary = result.length > 200 ? result.substring(0, 200) + '...' : result
    sendNotification(name, summary)
  } catch (err: any) {
    sendNotification(name, `任务执行出错: ${err.message}`)
  } finally {
    runningTasks.delete(taskId)
  }
}

// 发送系统通知
function sendNotification(title: string, body: string): void {
  if (Notification.isSupported()) {
    new Notification({ title: `临智自动任务 - ${title}`, body }).show()
  }

  // 同时通过 IPC 通知渲染进程
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send('autoTask:notification', { title, body })
  }
}

// 计算下次运行时间（简单实现）
function getNextRun(cronExpr: string): string | null {
  try {
    const now = new Date()
    // 简单处理：对于标准 cron 表达式，返回当前时间 + 间隔的估计
    const parts = cronExpr.split(' ')
    if (parts.length !== 5) return null

    // 对于每小时执行，返回下一个小时
    if (parts[0] === '0' && parts[1] === '*') {
      const next = new Date(now)
      next.setHours(next.getHours() + 1, 0, 0, 0)
      return next.toISOString()
    }
    // 对于每天执行
    if (parts[0] !== '*' && parts[1] !== '*' && parts[2] === '*' && parts[3] === '*' && parts[4] === '*') {
      const next = new Date(now)
      next.setDate(next.getDate() + 1)
      return next.toISOString()
    }
    // 对于每周执行
    if (parts[4] !== '*') {
      const next = new Date(now)
      next.setDate(next.getDate() + 7)
      return next.toISOString()
    }

    return null
  } catch {
    return null
  }
}
