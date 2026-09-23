// 审批应答 + 安全设置/审计 IPC
// - approval:respond      渲染端对审批请求的应答
// - security:listRisks    工具风险等级（供 UI 分组展示）
// - security:listPolicies 读取各工具策略覆盖
// - security:setPolicy    设置/清除某工具策略覆盖
// - security:listRemembered / security:forgetRemembered  已记住批准的查看与撤销
// - security:listAudit / security:clearAudit             审计日志

import { ipcMain, dialog, BrowserWindow } from 'electron'
import { approvalManager } from '../security/approval-manager'
import { listAudit, clearAudit } from '../security/audit'
import { getProtectedPaths, addProtectedPath, removeProtectedPath, normalizePath } from '../security/file-protection'
import {
  getToolPolicy,
  setToolPolicy,
  buildFingerprint,
  summarizeArgs,
  forgetApproval
} from '../agents/tools/permission.service'
import { TOOL_RISK_MAP } from '../agents/tools/security-policy'
import { getAppConfig } from '../store/app-config'

// 目录选择对话框的宿主窗口（无焦点窗口时退到第一个主窗口）
function pickDialogHost(): BrowserWindow {
  const wins = BrowserWindow.getAllWindows()
  return wins.find((w) => w.isFocused()) || wins[0]
}

export function registerApprovalIPC(): void {
  ipcMain.handle('approval:respond', (_event, payload: { requestId: string; decision: 'approve' | 'deny'; remember: boolean }) => {
    if (!payload || !payload.requestId) return false
    return approvalManager.handleResponse(payload.requestId, payload.decision, Boolean(payload.remember))
  })

  ipcMain.handle('security:listRisks', () => {
    return TOOL_RISK_MAP
  })

  ipcMain.handle('security:getMode', () => {
    return getAppConfig().get('permissionMode') || 'default'
  })

  ipcMain.handle('security:setMode', (_event, mode: string) => {
    if (mode !== 'default' && mode !== 'full') return { success: false, error: '非法模式' }
    getAppConfig().set('permissionMode', mode)
    return { success: true }
  })

  ipcMain.handle('security:listPolicies', () => {
    const config = getAppConfig()
    return config.get('toolPermissions') || {}
  })

  ipcMain.handle('security:setPolicy', (_event, toolName: string, action: 'allow' | 'ask' | 'deny' | null) => {
    if (!toolName || typeof toolName !== 'string') return { success: false, error: '工具名非法' }
    // IPC 不强制 TS 类型，须运行时校验防任意值落入配置
    if (action !== null && !['allow', 'ask', 'deny'].includes(action)) {
      return { success: false, error: '非法策略值' }
    }
    setToolPolicy(toolName, action)
    return { success: true }
  })

  ipcMain.handle('security:listRemembered', () => {
    const config = getAppConfig()
    return config.get('rememberedApprovals') || []
  })

  ipcMain.handle('security:forgetRemembered', (_event, fingerprint: string) => {
    if (!fingerprint || typeof fingerprint !== 'string') return { success: false, error: '指纹非法' }
    forgetApproval(fingerprint)
    return { success: true }
  })

  ipcMain.handle('security:listAudit', (_event, limit?: number) => {
    return listAudit(limit && limit > 0 ? limit : 200)
  })

  ipcMain.handle('security:clearAudit', () => {
    return { success: clearAudit() }
  })

  // 供工具在运行时统一生成审批元数据（避免各处重复拼装）
  ipcMain.handle('security:previewFingerprint', (_event, toolName: string, args: unknown) => {
    if (!toolName) return { fingerprint: '', argsSummary: '' }
    return { fingerprint: buildFingerprint(toolName, args), argsSummary: summarizeArgs(toolName, args) }
  })

  // ===== 文件防护：受保护路径管理 =====
  ipcMain.handle('security:listProtected', () => {
    return getProtectedPaths()
  })

  ipcMain.handle('security:addProtected', (_event, p: string) => {
    return addProtectedPath(p)
  })

  ipcMain.handle('security:removeProtected', (_event, p: string) => {
    return removeProtectedPath(p)
  })

  ipcMain.handle('security:pickProtectedDirectory', async () => {
    const host = pickDialogHost()
    const result = await dialog.showOpenDialog(host, {
      title: '选择要保护的文件夹（Agent 工具将无法访问）',
      properties: ['openDirectory']
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return normalizePath(result.filePaths[0])
  })
}
