export type McpTransport = 'stdio' | 'http' | 'sse' | 'cli'
export type McpStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

export interface McpServer {
  id: string
  name: string
  description: string | null
  icon: string | null
  transport: McpTransport
  command: string | null
  args: string[] | null
  cwd: string | null
  env: Record<string, string> | null
  url: string | null
  enabled: boolean
  auto_start: boolean
  status: McpStatus
  last_error: string | null
  last_connected_at: string | null
  tool_count: number
  created_at: string
  updated_at: string
}

export interface McpToolInfo {
  name: string
  description: string
}

export interface McpTemplate {
  id: string
  name: string
  description: string
  icon: string
  transport: McpTransport
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
}

export interface McpTestResult {
  success: boolean
  toolCount: number
  tools: McpToolInfo[]
  error?: string
}

// 表单提交时的服务器配置（不含 DB 元字段）
export interface McpServerFormValues {
  id?: string
  name: string
  description?: string
  icon?: string
  transport: McpTransport
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
  enabled: boolean
  auto_start: boolean
}
