// 工具风险分级：每个工具有一个风险等级，映射到默认策略（allow/ask/deny）。
// 危险操作（写文件、执行脚本、委派、网络）默认 ask，需用户批准。

export type ToolRisk = 'read' | 'write' | 'execute' | 'delegate' | 'network'
export type PolicyAction = 'allow' | 'ask' | 'deny'

export const RISK_LABELS: Record<ToolRisk, { label: string; color: string }> = {
  read: { label: '只读', color: '#9CA3AF' },
  write: { label: '写入', color: '#FA8C16' },
  execute: { label: '执行', color: '#CF1322' },
  delegate: { label: '委派', color: '#722ED1' },
  network: { label: '网络', color: '#08979C' }
}

// 内置工具风险等级；未列出的工具（含 MCP 工具）按 network 处理（最保守）
export const TOOL_RISK_MAP: Record<string, ToolRisk> = {
  calculator: 'read',
  aero_calculator: 'read',
  knowledge_search: 'read',
  db_tables: 'read',
  db_query: 'read',
  file_read: 'read',
  file_list: 'read',
  file_write: 'write',
  html_to_word: 'write',
  run_skill_script: 'execute',
  python: 'execute',
  node: 'execute',
  browser: 'network',
  delegate_to_agent: 'delegate'
}

// 各风险等级的默认策略
export const RISK_DEFAULT_ACTION: Record<ToolRisk, PolicyAction> = {
  read: 'allow',
  write: 'ask',
  execute: 'ask',
  delegate: 'ask',
  network: 'ask'
}

export function getToolRisk(toolName: string): ToolRisk {
  return TOOL_RISK_MAP[toolName] || 'network'
}

export function getDefaultAction(toolName: string): PolicyAction {
  return RISK_DEFAULT_ACTION[getToolRisk(toolName)]
}
