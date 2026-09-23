import Store from 'electron-store'
import { safeStorage } from 'electron'
import { v4 as uuidv4 } from 'uuid'

export interface OllamaConfig {
  baseURL: string
  modelName: string
  enabled: boolean
}

export type ToolPolicyAction = 'allow' | 'ask' | 'deny'

export interface RememberedApproval {
  fingerprint: string  // 工具名 + 归一化参数的稳定串，精确限定"始终允许"作用域
  toolName: string
  argsSummary: string
  ts: number
}

export interface Workspace {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
  folder?: string  // 该工作区绑定的文件工作空间目录（agent 文件工具 + 文件管理器共用）
}

interface AppConfigSchema {
  apiKey: string          // 废弃：旧版明文存储，仅保留以读取迁移；新写入走 apiKeyCipher
  apiKeyCipher: string    // safeStorage 加密后的密文（base64），优先读取；空串表示未设置
  modelProvider: string
  modelName: string
  baseURL: string
  fallbackModel: string
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
  toolPermissions: Record<string, ToolPolicyAction>  // 按工具策略覆盖：allow/ask/deny（全局按工具粒度）
  rememberedApprovals: RememberedApproval[]  // 用户"始终允许"的操作（按指纹精确匹配，可撤销）
  approvalTimeoutMs: number  // 审批等待超时（毫秒），超时自动拒绝，默认 120000
  maxToolRounds: number  // 多轮工具调用最大轮数（防止 LLM 陷入死循环），默认 100；设置页可调
  restrictNetwork: boolean  // 脚本执行尽力禁网（Windows 上为尽力而为）
  permissionMode: 'default' | 'full'  // default=每类危险操作逐次询问 | full=完全访问（仅文件写入仍提醒，其余放行）
  protectedPaths: string[]  // 文件防护：受保护的敏感文件/目录，Agent 工具访问时一律拦截
  quitOnClose: boolean  // 生产模式下关闭窗口时退出进程（true=退出，false=最小化到托盘）
  backgroundImage: string  // 自定义背景图片的绝对路径（复制到 userData/backgrounds/ 下），空串表示未设置
  backgroundFit: 'cover' | 'contain' | 'center' | 'repeat'  // 背景填充模式
  backgroundOpacity: number  // 内容遮罩透明度 0–1（背景激活时侧边栏/工作区底色透明度）
  updateServerUrl: string  // 补丁更新服务器地址（空串=禁用在线更新）
  updateAutoCheck: boolean  // 启动时自动检查更新（默认 true）
}

let appConfig: Store<AppConfigSchema>

const defaults: AppConfigSchema = {
  apiKey: '',
  apiKeyCipher: '',
  modelProvider: 'deepseek',
  modelName: 'deepseek-chat',
  baseURL: 'https://api.deepseek.com',
  fallbackModel: '',
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
  trustedSkillPackages: [],
  toolPermissions: {},
  rememberedApprovals: [],
  approvalTimeoutMs: 120000,
  maxToolRounds: 100,
  restrictNetwork: false,
  permissionMode: 'default',
  protectedPaths: [],
  quitOnClose: true,
  backgroundImage: '',
  backgroundFit: 'cover',
  backgroundOpacity: 0.85,
  updateServerUrl: '',
  updateAutoCheck: true
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

// API Key 使用 Electron safeStorage（Windows 走 DPAPI）加密后落盘，避免明文存储。
// 优先读取加密密文 apiKeyCipher 并解密；首次升级时把旧明文 apiKey 迁移为密文并清除明文。
// safeStorage 不可用时（极少数环境）回退明文 apiKey 并告警。
export function getApiKeyDecrypted(): string {
  const config = getAppConfig()
  const cipher = config.get('apiKeyCipher') as string | undefined
  if (cipher) {
    try {
      return safeStorage.decryptString(Buffer.from(cipher, 'base64'))
    } catch (err) {
      console.warn('[Config] API key 解密失败，回退明文:', err)
    }
  }
  // 迁移旧版明文 apiKey → 加密密文（仅首次）
  const plain = (config.get('apiKey') as string) || ''
  if (plain && safeStorage.isEncryptionAvailable()) {
    setApiKeyEncrypted(plain)
  }
  return plain
}

export function setApiKeyEncrypted(plain: string): void {
  const config = getAppConfig()
  if (!plain) {
    config.set('apiKeyCipher', '')
    config.delete('apiKey')
    return
  }
  if (safeStorage.isEncryptionAvailable()) {
    const encrypted = safeStorage.encryptString(plain)
    config.set('apiKeyCipher', encrypted.toString('base64'))
    // 清除旧明文，避免密钥同时以明文落盘
    config.delete('apiKey')
  } else {
    console.warn('[Config] safeStorage 不可用，API key 仍以明文存储')
    config.set('apiKey', plain)
  }
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

// --- 文件工作空间目录（Agent 文件工具 + 文件管理器共用）---
// 优先取当前工作区绑定的目录；旧版本只写了全局 fileWorkspacePath 字段，
// 未绑定到工作区时回退读取全局值，保证升级后原有设置不丢。

export function getFileWorkspacePath(): string {
  const ws = getCurrentWorkspace()
  if (ws?.folder) return ws.folder
  return (getAppConfig().get('fileWorkspacePath') as string) || ''
}

// 同时写入全局字段与当前工作区绑定，两条读取路径保持一致。
export function setFileWorkspacePath(folder: string): void {
  const config = getAppConfig()
  config.set('fileWorkspacePath', folder)
  const ws = getCurrentWorkspace()
  if (!ws) return
  const list: Workspace[] = config.get('workspaces.list') || []
  const idx = list.findIndex((w) => w.id === ws.id)
  if (idx >= 0) {
    list[idx].folder = folder
    config.set('workspaces.list', list)
  }
}
