import { useState, useEffect } from 'react'
import { Button, Tag, Empty, message, Popconfirm, Tabs } from 'antd'
import { PlusOutlined, EditOutlined, DeleteOutlined, UndoOutlined, AppstoreOutlined, ToolOutlined, ThunderboltOutlined, ImportOutlined, DownloadOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useCustomAgentStore } from '../stores/customAgentStore'
import { AGENT_NAMES, AGENT_COLORS, AGENT_ICONS } from '../types/agent'
import type { BuiltinAgentType } from '../types/agent'
import { parseMcpServerMarker } from '../types/customAgent'
import type { CustomAgentData } from '../types/customAgent'
import McpServersTab from '../components/McpServersTab'
import ToolsOverviewTab from '../components/ToolsOverviewTab'
import AgentSkillsTab from '../components/AgentSkillsTab'
import AgentIcon from '../components/AgentIcon'
import ImportAgentsModal, { type AgentImportCandidate } from '../components/ImportAgentsModal'

const BUILTIN_DESCRIPTIONS: Record<BuiltinAgentType, string> = {
  orchestrator: '分析用户飞行器设计任务，调度专业 Agent 协同工作',
  general: '处理日常通用对话，无需调度专业 Agent',
  aero: '飞行器气动分析与设计，包括升阻特性、压力分布等',
  structural: '飞行器结构分析与设计，包括强度、刚度、疲劳寿命等',
  propulsion: '动力系统匹配与分析，包括发动机选型、推力性能等',
  avionics: '控制系统与航电方案设计，包括飞控、导航、通信等',
  simulation: '协调仿真工具调用与结果解析，包括CFD、FEA等',
  documentation: '技术文档撰写与数据整理，包括报告生成、规范输出等',
  retriever: '知识检索和文献调研，从知识库获取相关技术资料'
}

const BUILTIN_AGENTS = (Object.keys(AGENT_NAMES) as BuiltinAgentType[]).map((type) => ({
  type,
  name: AGENT_NAMES[type],
  color: AGENT_COLORS[type],
  icon: AGENT_ICONS[type],
  description: BUILTIN_DESCRIPTIONS[type],
  isBuiltin: true
}))

function parseJsonArray(str: string): string[] {
  try { return JSON.parse(str) } catch { return [] }
}

function AgentsListTab(): JSX.Element {
  const navigate = useNavigate()
  const {
    agents, builtinAgents, loading,
    availableTools,
    fetchAgents, fetchBuiltinAgents, fetchAvailableTools,
    deleteAgent, resetBuiltinAgent,
    exportAgent, importParse, importConfirm
  } = useCustomAgentStore()

  const [importOpen, setImportOpen] = useState(false)
  const [importCandidates, setImportCandidates] = useState<AgentImportCandidate[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importParsing, setImportParsing] = useState(false)

  useEffect(() => {
    fetchAgents()
    fetchBuiltinAgents()
    if (availableTools.length === 0) fetchAvailableTools()
  }, [fetchAgents, fetchBuiltinAgents, fetchAvailableTools, availableTools.length])

  // 把 mcp_server:xxx marker 解析为友好的服务器名（找不到时回退 serverId）
  const resolveToolLabel = (tool: string): { text: string; color: string } => {
    const sid = parseMcpServerMarker(tool)
    if (sid) {
      const serverName = availableTools.find((t) => t.serverId === sid)?.serverName || sid
      return { text: `📦 ${serverName} 全部`, color: 'purple' }
    }
    return { text: tool, color: 'blue' }
  }

  const handleDelete = async (id: string): Promise<void> => {
    const result = await deleteAgent(id)
    if (result.success) {
      message.success('Agent 已删除')
    } else {
      message.error(result.error || '删除失败')
    }
  }

  const handleResetBuiltin = async (id: string): Promise<void> => {
    const result = await resetBuiltinAgent(id)
    if (result.success) {
      message.success('Agent 已重置为默认配置')
    } else {
      message.error(result.error || '重置失败')
    }
  }

  const handleExport = async (agent: CustomAgentData): Promise<void> => {
    const r = await exportAgent(agent.id)
    if (r.success && r.filePath) {
      message.success(`已导出到 ${r.filePath}`)
    } else if (r.canceled) {
      // 用户取消，静默
    } else {
      message.error(r.error || '导出失败')
    }
  }

  const handleImportPick = async (): Promise<void> => {
    setImportParsing(true)
    try {
      const paths = await window.aeromind.customAgent.importPick()
      if (paths.length === 0) return
      const { candidates, errors } = await importParse(paths)
      setImportErrors(errors)
      setImportCandidates(candidates)
      if (candidates.length === 0 && errors.length === 0) {
        message.warning('未在所选文件中找到可导入的 Agent')
        return
      }
      setImportOpen(true)
    } finally {
      setImportParsing(false)
    }
  }

  const displayBuiltinAgents = builtinAgents.length > 0
    ? builtinAgents.map((a) => ({
        type: a.id,
        name: a.name,
        color: a.color,
        icon: a.icon,
        description: a.description || BUILTIN_DESCRIPTIONS[a.id as BuiltinAgentType] || '',
        delegatesTo: parseJsonArray(a.delegates_to || '[]'),
        engine: a.engine === 'pi' ? 'pi' : 'deepseek' as 'deepseek' | 'pi',
        isBuiltin: true
      }))
    : BUILTIN_AGENTS.map((a) => ({
        ...a,
        delegatesTo: [] as string[],
        engine: 'deepseek' as const
      }))

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Agent 管理</h2>
        <div className="flex items-center gap-2">
          <Button
            icon={<ImportOutlined />}
            loading={importParsing}
            onClick={handleImportPick}
          >
            导入 Agent
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/agents/new')}
          >
            创建 Agent
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8 text-gray-600">加载中...</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {displayBuiltinAgents.map((agent) => (
            <div key={agent.type} className="bg-white rounded-card border border-line-light p-4 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: agent.color + '14' }}
                  >
                    <AgentIcon icon={agent.icon} className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-medium text-gray-900">{agent.name}</h4>
                </div>
                <div className="flex items-center gap-1">
                  <Tag color="gold" style={{ fontSize: 10 }}>内置</Tag>
                  {agent.engine === 'pi' && (
                    <Tag color="purple" style={{ fontSize: 10 }}>Pi</Tag>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-600 mb-2 line-clamp-2">{agent.description}</p>
              {agent.delegatesTo.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {agent.delegatesTo.map((delegateType) => (
                    <Tag
                      key={delegateType}
                      style={{ fontSize: 10, backgroundColor: AGENT_COLORS[delegateType as BuiltinAgentType] + '20', color: AGENT_COLORS[delegateType as BuiltinAgentType], borderColor: AGENT_COLORS[delegateType as BuiltinAgentType] + '40' }}
                    >
                      {AGENT_NAMES[delegateType as BuiltinAgentType] || delegateType}
                    </Tag>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: agent.color }}
                  />
                  <span className="text-xs text-gray-400">{agent.type}</span>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => navigate(`/agents/${agent.type}/edit?builtin=true`)}
                  />
                  <Popconfirm
                    title="确定重置此内置 Agent 为默认配置？"
                    onConfirm={() => handleResetBuiltin(agent.type)}
                    okText="重置"
                    cancelText="取消"
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<UndoOutlined />}
                      title="重置为默认"
                    />
                  </Popconfirm>
                </div>
              </div>
            </div>
          ))}

          {agents.map((agent: CustomAgentData) => (
            <div key={agent.id} className="bg-white rounded-card border border-line-light p-4 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
              <div className="flex items-start justify-between mb-2">
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                    style={{ backgroundColor: (agent.color || '#1E6FCC') + '14' }}
                  >
                    <AgentIcon icon={agent.icon} className="w-5 h-5" />
                  </div>
                  <h4 className="text-sm font-medium text-gray-900">{agent.name}</h4>
                </div>
                <div className="flex items-center gap-1">
                  <Tag color="green" style={{ fontSize: 10 }}>自定义</Tag>
                  {agent.engine === 'pi' && (
                    <Tag color="purple" style={{ fontSize: 10 }}>Pi</Tag>
                  )}
                </div>
              </div>
              <p className="text-xs text-gray-600 mb-3 line-clamp-2">{agent.description || '暂无描述'}</p>
              <div className="flex flex-wrap gap-1 mb-2">
                {parseJsonArray(agent.tools).map((tool) => {
                  const { text, color } = resolveToolLabel(tool)
                  return (
                    <Tag key={tool} color={color} style={{ fontSize: 10 }}>{text}</Tag>
                  )
                })}
                {parseJsonArray(agent.keywords).map((kw) => (
                  <Tag key={kw} style={{ fontSize: 10 }}>{kw}</Tag>
                ))}
              </div>
              {parseJsonArray(agent.delegates_to || '[]').length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {parseJsonArray(agent.delegates_to).map((delegateType) => (
                    <Tag
                      key={delegateType}
                      style={{ fontSize: 10, backgroundColor: AGENT_COLORS[delegateType as BuiltinAgentType] ? AGENT_COLORS[delegateType as BuiltinAgentType] + '20' : undefined, color: AGENT_COLORS[delegateType as BuiltinAgentType] || undefined }}
                    >
                      {AGENT_NAMES[delegateType as BuiltinAgentType] || delegateType}
                    </Tag>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mt-1">
                <div className="flex items-center gap-1">
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: agent.color }}
                  />
                  <span className="text-xs text-gray-400">{agent.model_name}</span>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => navigate(`/agents/${agent.id}/edit`)}
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<DownloadOutlined />}
                    title="导出"
                    onClick={() => handleExport(agent)}
                  />
                  <Popconfirm
                    title="确定删除此自定义 Agent？"
                    onConfirm={() => handleDelete(agent.id)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button
                      type="text"
                      size="small"
                      icon={<DeleteOutlined />}
                      danger
                    />
                  </Popconfirm>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && agents.length === 0 && displayBuiltinAgents.length === 0 && (
        <Empty description="暂无 Agent" />
      )}

      <ImportAgentsModal
        open={importOpen}
        candidates={importCandidates}
        errors={importErrors}
        onClose={() => setImportOpen(false)}
        onImported={() => { fetchAgents(); fetchBuiltinAgents() }}
      />
    </div>
  )
}

export default function AgentsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState('agents')

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'agents',
              label: (
                <span>
                  <EditOutlined /> Agent 列表
                </span>
              ),
              children: <AgentsListTab />
            },
            {
              key: 'mcp',
              label: (
                <span>
                  <AppstoreOutlined /> MCP 服务器
                </span>
              ),
              children: <McpServersTab />
            },
            {
              key: 'tools',
              label: (
                <span>
                  <ToolOutlined /> 工具总览
                </span>
              ),
              children: <ToolsOverviewTab />
            },
            {
              key: 'skills',
              label: (
                <span>
                  <ThunderboltOutlined /> 技能
                </span>
              ),
              children: <AgentSkillsTab />
            }
          ]}
        />
      </div>
    </div>
  )
}
