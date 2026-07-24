export type AgentEngine = 'deepseek' | 'pi'

export interface CustomAgentData {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  system_prompt: string
  tools: string          // JSON array string
  keywords: string       // JSON array string
  delegates_to: string   // JSON array string of agent types
  subtask_prefix: string | null
  model_name: string
  is_custom: number
  usage_count: number
  created_at: string
  updated_at: string
  engine: AgentEngine    // 底层 LLM 引擎：'deepseek' (LangChain 直连) | 'pi' (Pi SDK)
}

export type ToolSource = 'builtin' | 'mcp' | 'custom'

export interface ToolInfo {
  name: string
  description: string
  source?: ToolSource
  serverId?: string
  serverName?: string
}

// ============ MCP 服务器整体挂载 marker ============
// 在 agent 的 tools 数组中存 `mcp_server:${serverId}` 表示"挂载该服务器全部工具"。
// 后端 resolveToolsByNames 会展开为该服务器当前所有工具名，CATIA 升级新增工具会自动包含。
export const MCP_SERVER_MARKER_PREFIX = 'mcp_server:'

export function isMcpServerMarker(name: string): boolean {
  return name.startsWith(MCP_SERVER_MARKER_PREFIX)
}

export function parseMcpServerMarker(name: string): string | null {
  return isMcpServerMarker(name) ? name.slice(MCP_SERVER_MARKER_PREFIX.length) : null
}

export function buildMcpServerMarker(serverId: string): string {
  return MCP_SERVER_MARKER_PREFIX + serverId
}
