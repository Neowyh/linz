import type { Tool } from '@langchain/core/tools'
import type { AgentType, AgentContext, StreamChunk } from '../base.agent'
import { calculatorTool } from './calculator.tool'
import { aeroCalculatorTool } from './aero-calculator.tool'
import { knowledgeSearchTool } from './knowledge-search.tool'
import { xfoilTool } from './xfoil.tool'
import { createDelegateTool } from './delegate.tool'
import { createFilesystemTools } from './filesystem.tool'
import { toolRegistry, type ToolInfo } from './registry'

const AERO_TOOLS: Tool[] = [aeroCalculatorTool, calculatorTool, knowledgeSearchTool, xfoilTool]
const SIM_TOOLS: Tool[] = [calculatorTool, knowledgeSearchTool, xfoilTool]
const CALC_TOOLS: Tool[] = [calculatorTool, knowledgeSearchTool]
const KB_TOOLS: Tool[] = [knowledgeSearchTool]

const BUILTIN_TOOL_MAP: Record<string, Tool[]> = {
  orchestrator: [],
  general: CALC_TOOLS,
  aero: AERO_TOOLS,
  structural: CALC_TOOLS,
  propulsion: CALC_TOOLS,
  avionics: KB_TOOLS,
  simulation: SIM_TOOLS,
  documentation: KB_TOOLS,
  retriever: KB_TOOLS
}

// 静态内置工具信息（用于启动时注册到 toolRegistry + IPC 返回）
const BUILTIN_TOOL_INFOS: Array<{ name: string; description: string; tool: Tool }> = [
  { name: 'calculator', description: '通用数学计算器', tool: calculatorTool },
  { name: 'aero_calculator', description: '气动力公式计算（升力/阻力/雷诺数等）', tool: aeroCalculatorTool },
  { name: 'knowledge_search', description: '知识库检索', tool: knowledgeSearchTool },
  { name: 'xfoil', description: 'XFOIL 翼型分析', tool: xfoilTool }
]

// 启动时把内置工具注册到 ToolRegistry（一次性，幂等）
let builtinRegistered = false
export function registerBuiltinTools(): void {
  if (builtinRegistered) return
  for (const { name, description, tool } of BUILTIN_TOOL_INFOS) {
    toolRegistry.register(name, tool, { description, source: 'builtin' })
  }
  builtinRegistered = true
}

// 可用工具名列表（编译时常量，向后兼容；动态获取请用 getAvailableToolInfos）
export const AVAILABLE_TOOL_NAMES = [
  { name: 'calculator', description: '通用数学计算器' },
  { name: 'aero_calculator', description: '气动力公式计算（升力/阻力/雷诺数等）' },
  { name: 'knowledge_search', description: '知识库检索' },
  { name: 'xfoil', description: 'XFOIL 翼型分析' },
  { name: 'delegate_to_agent', description: '委派子任务给其他专业 Agent' }
]

// ============ MCP 服务器整体挂载 marker ============
// 在 agent 的 tools 数组中存 `mcp_server:${serverId}` 表示"挂载该服务器全部工具"。
// 运行时由 resolveToolsByNames 展开为该服务器当前所有工具名，CATIA 升级新增工具会自动包含。
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

// 动态获取所有已注册工具的信息（含 MCP 工具），供 IPC `agent:availableTools` 使用
export function getAvailableToolInfos(): ToolInfo[] {
  return toolRegistry.listInfos()
}

// 按名称从 ToolRegistry 解析工具实例（支持内置 + MCP + 自定义 + mcp_server:xxx marker）
// marker `mcp_server:${serverId}` 会被展开为该服务器当前所有工具名，结果去重。
// 服务器未连接或已删除时 marker 静默解析为空，不抛错。
export function resolveToolsByNames(names: string[]): Tool[] {
  const expanded = new Set<string>()
  for (const n of names) {
    const serverId = parseMcpServerMarker(n)
    if (serverId) {
      for (const tn of toolRegistry.listToolNamesByServer(serverId)) {
        expanded.add(tn)
      }
    } else {
      expanded.add(n)
    }
  }
  return Array.from(expanded)
    .map((n) => toolRegistry.get(n))
    .filter((t): t is Tool => t !== undefined)
}

export function getToolsForAgent(
  agentType: string,
  customToolNames?: string[],
  delegatesTo?: string[],
  agentContext?: AgentContext,
  onChunk?: (chunk: StreamChunk) => void
): Tool[] {
  // 内置 agent：若 customToolNames 有内容（来自 DB 的 tools 字段，含用户勾选的 MCP 工具），
  // 优先用它解析；否则回退到 BUILTIN_TOOL_MAP（向后兼容未编辑过的内置 agent）
  const builtin = BUILTIN_TOOL_MAP[agentType]
  let tools: Tool[]
  if (customToolNames && customToolNames.length > 0) {
    tools = resolveToolsByNames(customToolNames)
  } else if (builtin) {
    tools = [...builtin]
  } else {
    tools = []
  }

  // Add delegate tool if this agent has delegation targets AND we're in collaborative mode.
  // 单 Agent 模式不注入 delegate，确保"单 Agent"真正只跑一个 Agent（LLM 无从调用委派）
  if (delegatesTo && delegatesTo.length > 0 && agentContext && agentContext.dispatchMode === 'collaborative') {
    const delegateTool = createDelegateTool({
      callerType: agentType,
      allowedTargets: delegatesTo,
      context: agentContext,
      onChunk
    })
    tools.push(delegateTool as unknown as Tool)
  }

  // 设置了工作空间目录时，所有 agent 自动获得文件读写工具（读/写/列目录）
  // 路径安全由工具内部的白名单校验保证，仅可访问 fileWorkspacePath 内文件
  if (agentContext?.fileWorkspacePath) {
    tools.push(...createFilesystemTools({ context: agentContext }))
  }

  return tools
}
