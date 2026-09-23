import { ipcMain } from 'electron'
import { getAppConfig } from '../store/app-config'
import { getApiKeyDecrypted, setApiKeyEncrypted } from '../store/app-config'

// 安全敏感字段黑名单：禁止经通用 settings:get/set 读写，防渲染层被攻陷后提权/窃密。
// 这些字段已有专用 IPC 通道进行受控访问（security:* 系列 / settings:getApiKey 等）。
// 注意：skillScriptEnabled 仍走通用通道（设置页开关直接读写，无专用通道）。
const SENSITIVE_KEYS = new Set([
  'apiKey', // 旧明文字段 → 走 settings:getApiKey（safeStorage 解密）
  'apiKeyCipher', // 加密密文 → 绝不向渲染层暴露
  'permissionMode', // 走 security:getMode / security:setMode
  'toolPermissions', // 走 security:listPolicies / security:setPolicy
  'protectedPaths', // 走 security:listProtected / addProtected / removeProtected
  'rememberedApprovals', // 走 security:listRemembered / forgetRemembered
  'restrictNetwork', // 安全开关，仅主进程读取
  'trustedSkillPackages' // 信任列表，仅主进程读取
])

export function registerSettingsIPC(): void {
  ipcMain.handle('settings:get', async (_event, key: string) => {
    if (typeof key !== 'string' || SENSITIVE_KEYS.has(key)) return undefined
    const config = getAppConfig()
    return config.get(key)
  })

  ipcMain.handle('settings:set', async (_event, key: string, value: any) => {
    if (typeof key !== 'string' || SENSITIVE_KEYS.has(key)) {
      return { success: false, error: `字段「${key}」受保护，请使用专用设置入口` }
    }
    const config = getAppConfig()
    config.set(key, value)
    return { success: true }
  })

  // 专用 API Key 通道（safeStorage 加密存储），避免明文经通用 settings:get/set 泄露
  ipcMain.handle('settings:getApiKey', async () => {
    return getApiKeyDecrypted()
  })

  ipcMain.handle('settings:setApiKey', async (_event, key: string) => {
    setApiKeyEncrypted(typeof key === 'string' ? key : '')
    return { success: true }
  })
}
