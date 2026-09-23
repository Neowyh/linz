import type { Tool } from '@langchain/core/tools'
import type { AgentType, AgentContext, StreamChunk } from '../base.agent'
import { getDatabase } from '../../database'
import { calculatorTool } from './calculator.tool'
import { aeroCalculatorTool } from './aero-calculator.tool'
import { knowledgeSearchTool, createKnowledgeSearchTool } from './knowledge-search.tool'
import { knowledgeGraphSearchTool } from './knowledge-graph-search.tool'
import { dbTablesTool, dbQueryTool } from './db-query.tool'
import { runSkillScriptTool } from './run-skill-script.tool'
import { htmlToWordTool } from './html-to-word.tool'
import { pythonTool } from './python.tool'
import { nodeTool } from './node.tool'
import { browserTool } from './browser.tool'
import { createDelegateTool } from './delegate.tool'
import { createFilesystemTools } from './filesystem.tool'
import { createCodeFsTools } from './code-fs.tool'
import { readSkillFileTool } from './read-skill-file.tool'
import { toolRegistry, type ToolInfo } from './registry'

const DB_TOOLS: Tool[] = [dbTablesTool, dbQueryTool]
// 注：plot_chart / data_analysis 已移除，可视化与统计分析统一由 python 工具（matplotlib/scipy/pandas）承担
const AERO_TOOLS: Tool[] = [aeroCalculatorTool, calculatorTool, knowledgeSearchTool, runSkillScriptTool, pythonTool, browserTool, ...DB_TOOLS]
const SIM_TOOLS: Tool[] = [calculatorTool, knowledgeSearchTool, runSkillScriptTool, pythonTool, browserTool, ...DB_TOOLS]
const CALC_TOOLS: Tool[] = [calculatorTool, knowledgeSearchTool, knowledgeGraphSearchTool, runSkillScriptTool, pythonTool, browserTool, ...DB_TOOLS]
const KB_TOOLS: Tool[] = [knowledgeSearchTool, knowledgeGraphSearchTool, runSkillScriptTool, ...DB_TOOLS]
// 文档类内置技能（docx/pdf/pptx/xlsx）依赖内联 Python 与内联 JS（docx-js/pptxgenjs）
const DOC_TOOLS: Tool[] = [knowledgeSearchTool, runSkillScriptTool, pythonTool, nodeTool, ...DB_TOOLS]

const BUILTIN_TOOL_MAP: Record<string, Tool[]> = {
  orchestrator: [],
  general: CALC_TOOLS,
  aero: AERO_TOOLS,
  structural: CALC_TOOLS,
  propulsion: CALC_TOOLS,
  avionics: KB_TOOLS,
  simulation: SIM_TOOLS,
  documentation: DOC_TOOLS,
  retriever: KB_TOOLS
}

// 静态内置工具信息（用于启动时注册到 toolRegistry + IPC 返回）
const BUILTIN_TOOL_INFOS: Array<{ name: string; description: string; tool: Tool }> = [
  { name: 'calculator', description: '通用数学计算器', tool: calculatorTool },
  { name: 'aero_calculator', description: '气动力公式计算（升力/阻力/雷诺数等）', tool: aeroCalculatorTool },
  { name: 'knowledge_search', description: '知识库检索', tool: knowledgeSearchTool },
  { name: 'query_knowledge_graph', description: '查询知识图谱探索实体关系和知识网络', tool: knowledgeGraphSearchTool },
  { name: 'db_tables', description: '列出表格数据库中的数据表结构', tool: dbTablesTool },
  { name: 'db_query', description: '对表格数据库执行只读 SQL 查询', tool: dbQueryTool },
  { name: 'run_skill_script', description: '执行技能包附带脚本（.py/.js/.bat 等）', tool: runSkillScriptTool },
  { name: 'html_to_word', description: '将 HTML 文档转换为 Word 文档并可套用参考 Word 模板样式', tool: htmlToWordTool },
  { name: 'python', description: '执行内嵌 Python 3.8.10 代码（numpy/matplotlib/scipy/pandas 可用）用于计算与可视化', tool: pythonTool },
  { name: 'node', description: '执行内联 JavaScript（内置 Node + docx/pptxgenjs 库），用于生成 Word/PPT 等', tool: nodeTool },
  { name: 'browser', description: '操作应用内嵌侧边栏浏览器（导航/点击/输入/滚动/截图/读取页面）', tool: browserTool },
  { name: 'read_skill_file', description: '读取技能包内被 SKILL.md 引用的文件（渐进披露）', tool: readSkillFileTool }
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
  { name: 'query_knowledge_graph', description: '查询知识图谱探索实体关系和知识网络' },
  { name: 'db_tables', description: '列出表格数据库中的数据表结构' },
  { name: 'db_query', description: '对表格数据库执行只读 SQL 查询' },
  { name: 'run_skill_script', description: '执行技能包附带脚本（.py/.js/.bat 等）' },
  { name: 'html_to_word', description: '将 HTML 文档转换为 Word 文档并可套用参考 Word 模板样式' },
  { name: 'python', description: '执行内嵌 Python 3.8.10 代码（numpy/matplotlib/scipy/pandas 可用）用于计算与可视化' },
  { name: 'node', description: '执行内联 JavaScript（内置 Node + docx/pptxgenjs 库），用于生成 Word/PPT 等' },
  { name: 'browser', description: '操作应用内嵌侧边栏浏览器（导航/点击/输入/滚动/截图/读取页面）' },
  { name: 'read_skill_file', description: '读取技能包内被 SKILL.md 引用的文件（渐进披露）' },
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

// 读取 agent 的知识库限定标签（custom_agents.kb_tags，内置/自定义 agent 通用）
// 每次构建工具时直查 DB：单次 agent 运行只调用一次，开销可忽略，且天然跟随编辑生效
function getAgentKbTags(agentType: string): string[] {
  try {
    const db = getDatabase()
    const results = db.exec('SELECT kb_tags FROM custom_agents WHERE id = ?', [agentType])
    const raw = results[0]?.values[0]?.[0] as string | undefined
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((t): t is string => typeof t === 'string' && t.trim().length > 0) : []
  } catch {
    return []
  }
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

  // 若 agent 配置了知识库限定标签，替换 knowledge_search 为带标签过滤的实例
  const kbTags = getAgentKbTags(agentType)
  if (kbTags.length > 0) {
    tools = tools.map((t) => (t.name === 'knowledge_search' ? (createKnowledgeSearchTool(kbTags) as unknown as Tool) : t))
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
  // 以及代码审查专用只读工具（目录树/带行号读取/代码搜索）
  // 路径安全由工具内部的白名单校验保证，仅可访问 fileWorkspacePath 内文件
  if (agentContext?.fileWorkspacePath) {
    tools.push(...createFilesystemTools({ context: agentContext }))
    tools.push(...createCodeFsTools({ context: agentContext }))
  }

  return tools
}
