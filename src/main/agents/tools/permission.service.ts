// 权限策略引擎：对每个工具调用判定 allow/ask/deny。
// 判定优先级：显式 deny → 已记住的批准 → 按工具策略 → 风险等级默认。

import { getAppConfig } from '../../store/app-config'
import { getToolRisk, getDefaultAction, type PolicyAction } from './security-policy'

export type DecisionAction = 'allow' | 'ask' | 'deny'

export interface Decision {
  action: DecisionAction
  reason: string
  fingerprint: string
  risk: string
}

// 归一化参数：仅保留影响安全的稳定字段，排除正文/大段内容，
// 使"始终允许"作用域精确（同路径同脚本），不会误放行不同内容的调用。
function normalizeArgs(toolName: string, args: any): unknown {
  if (!args || typeof args !== 'object') return args
  switch (toolName) {
    case 'file_write':
      return { path: (args as any).path }
    case 'html_to_word':
      // 实际文件路径由原生对话框产生，不参与"记住批准"作用域；
      // 仅按任务描述记忆，避免路径变动导致每次都重问。
      return { task: (args as any).task ?? '' }
    case 'run_skill_script':
      return { skill: (args as any).skill, script: (args as any).script }
    case 'python': {
      // 代码每次不同，不能整段进指纹（否则"记住批准"永远匹配不上）。
      // 按粗粒度特征归一：是否写文件 / 是否碰网络或子进程，让"记住"作用域合理且稳定。
      const code: string = (args as any).code ?? ''
      return {
        has_file_write: /open\s*\([^)]*['"]w|\.write|\.savefig|\.to_csv|\.to_excel|os\.remove|shutil\./.test(code),
        has_net_or_subproc: /\bsocket\b|\brequest|urllib|subprocess|os\.system|os\.popen/.test(code)
      }
    }
    case 'delegate_to_agent':
      return { target_agent: (args as any).target_agent }
    case 'browser':
      // 归一化：保留影响安全的动作/网址/选择器，排除输入文本等大段内容，
      // 使"始终允许"作用域精确（同动作同网址不再重问），又不误放行不同内容的调用。
      return {
        action: (args as any).action ?? '',
        url: (args as any).url ?? '',
        selector: (args as any).selector ?? ''
      }
    default:
      return args
  }
}

export function buildFingerprint(toolName: string, args: any): string {
  try {
    return `${toolName}:${JSON.stringify(normalizeArgs(toolName, args))}`
  } catch {
    return `${toolName}:<unserializable>`
  }
}

export function summarizeArgs(toolName: string, args: any): string {
  if (!args || typeof args !== 'object') return args == null ? '' : String(args)
  try {
    const norm = normalizeArgs(toolName, args)
    const json = JSON.stringify(norm)
    return json.length > 200 ? json.slice(0, 200) + '...' : json
  } catch {
    return '<无法解析的参数>'
  }
}

export function isRemembered(toolName: string, args: any): boolean {
  const config = getAppConfig()
  const list = config.get('rememberedApprovals') || []
  const fingerprint = buildFingerprint(toolName, args)
  return list.some((r) => r.fingerprint === fingerprint)
}

export function rememberApproval(toolName: string, args: any): void {
  const config = getAppConfig()
  const fingerprint = buildFingerprint(toolName, args)
  const list = config.get('rememberedApprovals') || []
  if (list.some((r) => r.fingerprint === fingerprint)) return
  list.push({
    fingerprint,
    toolName,
    argsSummary: summarizeArgs(toolName, args),
    ts: Date.now()
  })
  config.set('rememberedApprovals', list)
}

export function forgetApproval(fingerprint: string): void {
  const config = getAppConfig()
  const list = config.get('rememberedApprovals') || []
  config.set('rememberedApprovals', list.filter((r) => r.fingerprint !== fingerprint))
}

export function getToolPolicy(toolName: string): PolicyAction | undefined {
  const config = getAppConfig()
  return (config.get('toolPermissions') as Record<string, PolicyAction> | undefined)?.[toolName]
}

export function setToolPolicy(toolName: string, action: PolicyAction | null): void {
  const config = getAppConfig()
  const policies = { ...(config.get('toolPermissions') || {}) }
  if (action === null) {
    delete policies[toolName]
  } else {
    policies[toolName] = action
  }
  config.set('toolPermissions', policies)
}

// 判定某个工具调用是否允许直接执行（不涉及用户交互，纯策略判定）
export function resolveDecision(toolName: string, args: any): Decision {
  const config = getAppConfig()
  const risk = getToolRisk(toolName)
  const fingerprint = buildFingerprint(toolName, args)
  const policy = getToolPolicy(toolName)
  const mode = config.get('permissionMode') || 'default'

  // 完全访问模式：除文件写入外，其余危险操作一律放行（显式 deny 仍是硬阻断）
  const inFullMode = mode === 'full'
  const onlyFileReminds = inFullMode && risk !== 'write'

  if (policy === 'deny') return { action: 'deny', reason: '该工具已被禁用', fingerprint, risk }
  if (isRemembered(toolName, args)) return { action: 'allow', reason: '已记住的批准', fingerprint, risk }
  if (policy === 'allow') return { action: 'allow', reason: '已配置为允许', fingerprint, risk }
  if (policy === 'ask') {
    if (onlyFileReminds) return { action: 'allow', reason: '完全访问模式', fingerprint, risk }
    return { action: 'ask', reason: '已配置为询问', fingerprint, risk }
  }

  const fallback = getDefaultAction(toolName)
  if (inFullMode) {
    if (risk === 'write') return { action: 'ask', reason: '完全访问模式（文件写入仍需确认）', fingerprint, risk }
    return { action: 'allow', reason: '完全访问模式', fingerprint, risk }
  }
  return { action: fallback, reason: `默认策略（${risk}）`, fingerprint, risk }
}
