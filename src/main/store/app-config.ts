import Store from 'electron-store'
import { v4 as uuidv4 } from 'uuid'

export interface TokenBudget {
  monthlyLimit: number
  warningThreshold: number
  enabled: boolean
}

export interface TokenUsageMonth {
  inputTokens: number
  outputTokens: number
}

export interface OllamaConfig {
  baseURL: string
  modelName: string
  enabled: boolean
}

export interface Workspace {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
}

interface AppConfigSchema {
  apiKey: string
  modelProvider: string
  modelName: string
  baseURL: string
  fallbackModel: string
  tokenBudget: TokenBudget
  tokenUsage: Record<string, TokenUsageMonth>
  contextCompressionThreshold: number
  theme: 'light' | 'dark' | 'system'
  ollama: OllamaConfig
  workspaces: {
    current: string
    list: Workspace[]
  }
  fileWorkspacePath: string  // agent 文件读写工具的合法根目录，空字符串表示未设置
  skillScriptEnabled: boolean  // 允许 Agent 执行技能包附带脚本（run_skill_script 工具总开关，默认关）
  trustedSkillPackages: string[]  // 用户已信任的技能 ID 列表（信任后脚本直接执行，不再弹窗）
}

let appConfig: Store<AppConfigSchema>

const defaults: AppConfigSchema = {
  apiKey: '',
  modelProvider: 'deepseek',
  modelName: 'deepseek-chat',
  baseURL: 'https://api.deepseek.com',
  fallbackModel: '',
  tokenBudget: {
    monthlyLimit: 1000000,
    warningThreshold: 0.8,
    enabled: true
  },
  tokenUsage: {},
  contextCompressionThreshold: 200000,
  theme: 'system',
  ollama: {
    baseURL: 'http://localhost:11434',
    modelName: 'qwen2.5:7b',
    enabled: false
  },
  workspaces: {
    current: '',
    list: []
  },
  fileWorkspacePath: '',
  skillScriptEnabled: false,
  trustedSkillPackages: []
}

export function getAppConfig(): Store<AppConfigSchema> {
  if (!appConfig) {
    appConfig = new Store<AppConfigSchema>({
      name: 'aeromind-config',
      defaults
    })
  }
  return appConfig
}

function getCurrentMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function getCurrentMonthUsage(): TokenUsageMonth {
  const config = getAppConfig()
  const key = getCurrentMonthKey()
  return (config.get(`tokenUsage.${key}`) as TokenUsageMonth | undefined) || { inputTokens: 0, outputTokens: 0 }
}

export function addTokenUsage(inputTokens: number, outputTokens: number): void {
  const config = getAppConfig()
  const key = getCurrentMonthKey()
  const current: TokenUsageMonth = (config.get(`tokenUsage.${key}`) as TokenUsageMonth | undefined) || { inputTokens: 0, outputTokens: 0 }
  config.set(`tokenUsage.${key}`, {
    inputTokens: current.inputTokens + inputTokens,
    outputTokens: current.outputTokens + outputTokens
  })
}

export function isOverBudget(): boolean {
  const config = getAppConfig()
  const budget = config.get('tokenBudget')
  if (!budget.enabled) return false
  const usage = getCurrentMonthUsage()
  return (usage.inputTokens + usage.outputTokens) >= budget.monthlyLimit
}

export function getBudgetPercentage(): number {
  const config = getAppConfig()
  const budget = config.get('tokenBudget')
  if (!budget.monthlyLimit) return 0
  const usage = getCurrentMonthUsage()
  return (usage.inputTokens + usage.outputTokens) / budget.monthlyLimit
}

// --- Workspace helpers ---

export function getCurrentWorkspace(): Workspace | null {
  const config = getAppConfig()
  const currentId = config.get('workspaces.current')
  const list: Workspace[] = (config.get('workspaces.list') as Workspace[] | undefined) || []
  return list.find((ws) => ws.id === currentId) || null
}

export function setCurrentWorkspace(id: string): void {
  const config = getAppConfig()
  const list: Workspace[] = (config.get('workspaces.list') as Workspace[] | undefined) || []
  if (!list.find((ws) => ws.id === id)) return
  config.set('workspaces.current', id)
  // Update lastOpenedAt
  const idx = list.findIndex((ws) => ws.id === id)
  if (idx >= 0) {
    list[idx].lastOpenedAt = new Date().toISOString()
    config.set('workspaces.list', list)
  }
}

export function addWorkspace(name: string): Workspace {
  const config = getAppConfig()
  const list: Workspace[] = (config.get('workspaces.list') as Workspace[] | undefined) || []
  const ws: Workspace = {
    id: uuidv4(),
    name,
    path: '',
    createdAt: new Date().toISOString(),
    lastOpenedAt: new Date().toISOString()
  }
  list.push(ws)
  config.set('workspaces.list', list)
  // Auto-set as current if no current workspace
  if (!config.get('workspaces.current')) {
    config.set('workspaces.current', ws.id)
  }
  return ws
}

export function removeWorkspace(id: string): boolean {
  const config = getAppConfig()
  const list: Workspace[] = (config.get('workspaces.list') as Workspace[] | undefined) || []
  // Cannot remove if it's the only workspace
  if (list.length <= 1) return false
  const filtered = list.filter((ws) => ws.id !== id)
  if (filtered.length === list.length) return false
  config.set('workspaces.list', filtered)
  // If removed current, switch to first
  if (config.get('workspaces.current') === id) {
    config.set('workspaces.current', filtered[0].id)
  }
  return true
}

export function renameWorkspace(id: string, name: string): boolean {
  const config = getAppConfig()
  const list: Workspace[] = (config.get('workspaces.list') as Workspace[] | undefined) || []
  const ws = list.find((w) => w.id === id)
  if (!ws) return false
  ws.name = name
  config.set('workspaces.list', list)
  return true
}

export function listWorkspaces(): Workspace[] {
  const config = getAppConfig()
  return config.get('workspaces.list') || []
}
