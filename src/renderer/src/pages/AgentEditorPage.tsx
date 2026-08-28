import { useState, useEffect } from 'react'
import { Input, Select, Button, Tag, message, Typography, Popconfirm } from 'antd'
import { ArrowLeftOutlined, SaveOutlined, UndoOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import { useCustomAgentStore } from '../stores/customAgentStore'
import { AGENT_NAMES } from '../types/agent'
import type { BuiltinAgentType } from '../types/agent'
import { isMcpServerMarker, parseMcpServerMarker, buildMcpServerMarker } from '../types/customAgent'
import { AgentIconPicker, AGENT_ICON_OPTIONS } from '../components/AgentIconPicker'
import type { ToolInfo } from '../types/customAgent'

const { TextArea } = Input
const { Text } = Typography

const PRESET_COLORS = [
  '#1890FF', '#722ED1', '#13C2C2', '#52C41A',
  '#FA8C16', '#F5222D', '#EB2F96', '#2F54EB',
  '#FAAD14', '#A0D911'
]

// 把扁平的工具列表转换为按 source 分组的 Select options（内置工具 + 各 MCP 服务器）
function buildToolSelectOptions(tools: ToolInfo[]): Array<{ label: string; options: Array<{ value: string; label: string }> }> {
  const groups: Array<{ label: string; options: Array<{ value: string; label: string }> }> = []
  const builtinTools = tools.filter((t) => !t.source || t.source === 'builtin')
  if (builtinTools.length > 0) {
    groups.push({
      label: `内置工具 (${builtinTools.length})`,
      options: builtinTools.map((t) => ({ value: t.name, label: t.description || t.name }))
    })
  }

  // 按 serverId 分组 MCP 工具
  const mcpByServer: Record<string, { serverName: string; tools: ToolInfo[] }> = {}
  for (const t of tools) {
    if (t.source !== 'mcp') continue
    const key = t.serverId || 'unknown'
    if (!mcpByServer[key]) {
      mcpByServer[key] = { serverName: t.serverName || t.serverId || 'MCP 服务器', tools: [] }
    }
    mcpByServer[key].tools.push(t)
  }
  for (const [serverId, group] of Object.entries(mcpByServer)) {
    groups.push({
      label: `${group.serverName} (${group.tools.length})`,
      options: [
        // 顶部插入"全部工具"marker 选项，运行时自动展开为该服务器全部工具
        {
          value: buildMcpServerMarker(serverId),
          label: `⚡ 全部工具（自动包含新增）`
        },
        ...group.tools.map((t) => ({
          value: t.name,
          // 显示前缀让用户清楚工具来源（如 "catia_create_sketch"）
          label: t.name.startsWith(`mcp:${serverId}:`)
            ? `${t.name.slice(`mcp:${serverId}:`.length)} — ${t.description || ''}`
            : `${t.name} — ${t.description || ''}`
        }))
      ]
    })
  }

  return groups
}

export default function AgentEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const isEditing = Boolean(id) && id !== 'new'
  const navigate = useNavigate()
  const location = useLocation()
  const searchParams = new URLSearchParams(location.search)
  const isBuiltin = searchParams.get('builtin') === 'true'

  const {
    agents, builtinAgents, availableTools,
    fetchAvailableTools, fetchBuiltinAgents,
    createAgent, updateAgent,
    updateBuiltinAgent, resetBuiltinAgent
  } = useCustomAgentStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState(PRESET_COLORS[0])
  const [icon, setIcon] = useState('assets/icons/orchestrator.svg')
  const [systemPrompt, setSystemPrompt] = useState('')
  const [tools, setTools] = useState<string[]>([])
  const [keywords, setKeywords] = useState<string[]>([])
  const [keywordInput, setKeywordInput] = useState('')
  const [delegatesTo, setDelegatesTo] = useState<string[]>([])
  const [subtaskPrefix, setSubtaskPrefix] = useState('')
  const [modelName, setModelName] = useState('deepseek-chat')
  const [engine, setEngine] = useState<'deepseek' | 'pi'>('deepseek')
  const [kbTags, setKbTags] = useState<string[]>([])
  const [availableKbTags, setAvailableKbTags] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    fetchAvailableTools()
    window.aeromind.kb.tags().then(setAvailableKbTags).catch(() => {})
    if (isBuiltin) {
      fetchBuiltinAgents()
    }
    if (isEditing && id) {
      loadAgent(id)
    }
  }, [id])

  const loadAgent = async (agentId: string): Promise<void> => {
    if (isBuiltin) {
      // Load from builtin agents
      const store = useCustomAgentStore.getState()
      let agent = store.builtinAgents.find((a) => a.id === agentId)
      if (!agent) {
        try {
          await store.fetchBuiltinAgents()
        } catch { /* ignore */ }
        agent = useCustomAgentStore.getState().builtinAgents.find((a) => a.id === agentId)
      }
      if (!agent) {
        message.error('内置 Agent 不存在')
        navigate('/agents')
        return
      }
      fillForm(agent)
      return
    }

    // Custom agent
    const existing = agents.find((a) => a.id === agentId)
    if (!existing) {
      try {
        await useCustomAgentStore.getState().fetchAgents()
      } catch { /* ignore */ }
      const agent = useCustomAgentStore.getState().agents.find((a) => a.id === agentId)
      if (!agent) {
        message.error('Agent 不存在')
        navigate('/agents')
        return
      }
      fillForm(agent)
      return
    }
    fillForm(existing)
  }

  const fillForm = (agent: any): void => {
    setLoading(true)
    setName(agent.name)
    setDescription(agent.description || '')
    setColor(agent.color || PRESET_COLORS[0])
    setIcon(agent.icon || 'assets/icons/orchestrator.svg')
    setSystemPrompt(agent.system_prompt || '')
    try { setTools(JSON.parse(agent.tools || '[]')) } catch { setTools([]) }
    try { setKeywords(JSON.parse(agent.keywords || '[]')) } catch { setKeywords([]) }
    try { setDelegatesTo(JSON.parse(agent.delegates_to || '[]')) } catch { setDelegatesTo([]) }
    setSubtaskPrefix(agent.subtask_prefix || '')
    setModelName(agent.model_name || 'deepseek-chat')
    setEngine(agent.engine === 'pi' ? 'pi' : 'deepseek')
    try { setKbTags(JSON.parse(agent.kb_tags || '[]')) } catch { setKbTags([]) }
    setLoading(false)
  }

  const handleKeywordConfirm = (): void => {
    const trimmed = keywordInput.trim()
    if (trimmed && !keywords.includes(trimmed)) {
      setKeywords([...keywords, trimmed])
    }
    setKeywordInput('')
  }

  const handleRemoveKeyword = (kw: string): void => {
    setKeywords(keywords.filter((k) => k !== kw))
  }

  // 工具选择互斥：marker 与同 server 的单个工具不能共存
  // 选 marker → 自动移除同 server 的已选单个工具；选单个工具 → 自动移除同 server 的 marker
  const handleToolsChange = (val: string[]): void => {
    const added = val.find((v) => !tools.includes(v))
    if (!added) {
      setTools(val)
      return
    }
    if (isMcpServerMarker(added)) {
      const sid = parseMcpServerMarker(added)
      if (!sid) { setTools(val); return }
      const sameServerNames = availableTools
        .filter((t) => t.source === 'mcp' && t.serverId === sid)
        .map((t) => t.name)
      setTools(val.filter((v) => !sameServerNames.includes(v)))
    } else {
      const info = availableTools.find((t) => t.name === added)
      if (info?.source === 'mcp' && info.serverId) {
        const marker = buildMcpServerMarker(info.serverId)
        setTools(val.filter((v) => v !== marker))
      } else {
        setTools(val)
      }
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) { message.warning('请输入 Agent 名称'); return }
    if (!systemPrompt.trim()) { message.warning('请输入系统提示词'); return }

    setSaving(true)
    try {
      const formData: Record<string, any> = {
        name: name.trim(),
        description: description.trim() || null,
        color,
        icon,
        system_prompt: systemPrompt.trim(),
        tools: JSON.stringify(tools),
        keywords: JSON.stringify(keywords),
        delegates_to: JSON.stringify(delegatesTo),
        subtask_prefix: subtaskPrefix.trim() || null,
        model_name: modelName.trim() || 'deepseek-chat',
        engine,
        kb_tags: JSON.stringify(kbTags)
      }

      if (isBuiltin && id) {
        const result = await updateBuiltinAgent(id, formData)
        if (result.success) {
          message.success('内置 Agent 已更新')
          navigate('/agents')
        } else {
          message.error(result.error || '更新失败')
        }
      } else if (isEditing && id) {
        const result = await updateAgent(id, {
          name: name.trim(),
          description: description.trim() || null,
          color,
          icon,
          systemPrompt: systemPrompt.trim(),
          tools,
          keywords,
          delegates_to: JSON.stringify(delegatesTo),
          subtaskPrefix: subtaskPrefix.trim() || null,
          modelName: modelName.trim() || 'deepseek-chat',
          engine,
          kbTags
        })
        if (result.success) {
          message.success('Agent 已更新')
          navigate('/agents')
        } else {
          message.error(result.error || '更新失败')
        }
      } else {
        const result = await createAgent({
          name: name.trim(),
          description: description.trim() || undefined,
          color,
          icon,
          systemPrompt: systemPrompt.trim(),
          tools,
          keywords,
          delegates_to: JSON.stringify(delegatesTo),
          subtaskPrefix: subtaskPrefix.trim() || null,
          modelName: modelName.trim() || 'deepseek-chat',
          engine,
          kbTags
        })
        if (result.success) {
          message.success('Agent 已创建')
          navigate('/agents')
        } else {
          message.error(result.error || '创建失败')
        }
      }
    } catch (err: any) {
      message.error('保存失败: ' + (err.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  const handleReset = async (): Promise<void> => {
    if (!id || !isBuiltin) return
    const result = await resetBuiltinAgent(id)
    if (result.success) {
      message.success('Agent 已重置为默认配置')
      await fetchBuiltinAgents()
      // Re-load the reset agent data into the form
      const store = useCustomAgentStore.getState()
      const resetAgent = store.builtinAgents.find((a) => a.id === id)
      if (resetAgent) {
        fillForm(resetAgent)
      }
    } else {
      message.error(result.error || '重置失败')
    }
  }

  // Build list of all agent types for delegates multi-select
  const allAgentTypes = [
    ...builtinAgents.map((a) => a.id),
    ...agents.map((a) => a.id)
  ].filter((v, i, arr) => arr.indexOf(v) === i) // deduplicate

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Text type="secondary">加载中...</Text>
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-3 mb-6">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/agents')} />
          <h2 className="text-lg font-semibold text-gray-900">
            {isBuiltin ? '编辑内置 Agent' : isEditing ? '编辑自定义 Agent' : '创建自定义 Agent'}
          </h2>
          {isBuiltin && <Tag color="gold">内置</Tag>}
        </div>

        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：气动优化 Agent"
              maxLength={50}
              showCount
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">描述</label>
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述该 Agent 的功能和用途"
              rows={2}
              maxLength={200}
              showCount
            />
          </div>

          {/* Color */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">颜色</label>
            <div className="flex items-center gap-2 flex-wrap">
              {PRESET_COLORS.map((c) => (
                <button
                  key={c}
                  className={`w-7 h-7 rounded-full border-2 transition-all ${
                    color === c ? 'border-gray-800 scale-110' : 'border-transparent hover:border-gray-300'
                  }`}
                  style={{ backgroundColor: c }}
                  onClick={() => setColor(c)}
                />
              ))}
              <Input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="w-7 h-7 p-0 cursor-pointer border-0"
                style={{ padding: 0 }}
              />
            </div>
          </div>

          {/* Icon */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">图标</label>
            <Text className="text-xs text-gray-600 block mb-2">
              选择内置图标，也可以输入自定义 Emoji 或图标路径
            </Text>
            <AgentIconPicker value={icon} onChange={setIcon} options={AGENT_ICON_OPTIONS} />
            <div className="flex items-center gap-2 mt-3">
              <span className="text-2xl w-8 text-center">{icon}</span>
              <Input
                value={icon}
                onChange={(e) => setIcon(e.target.value)}
                placeholder="输入 Emoji 或图标路径"
                className="flex-1"
              />
            </div>
          </div>

          {/* System Prompt */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">系统提示词</label>
            <Text className="text-xs text-gray-600 block mb-2">
              定义 Agent 的角色、专业领域、输出格式等
            </Text>
            <TextArea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder={'你是一名资深飞行器气动设计工程师，专注于飞行器气动分析与设计...'}
              rows={10}
              style={{ fontFamily: 'monospace' }}
            />
          </div>

          {/* Tools */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">工具</label>
            <Text className="text-xs text-gray-600 block mb-2">
              选择 Agent 可使用的工具，支持内置工具和已连接的 MCP 服务器工具
            </Text>
            <Select
              mode="multiple"
              value={tools}
              onChange={handleToolsChange}
              placeholder="选择 Agent 可使用的工具"
              className="w-full"
              showSearch
              filterOption={(input, option) => {
                const opt = option as { label?: string; value?: string } | undefined
                const text = opt?.label || ''
                const text2 = opt?.value || ''
                return (
                  text.toLowerCase().includes(input.toLowerCase()) ||
                  text2.toLowerCase().includes(input.toLowerCase())
                )
              }}
              options={buildToolSelectOptions(availableTools)}
            />
          </div>

          {/* Keywords */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">触发关键词</label>
            <div className="flex flex-wrap gap-1 mb-2">
              {keywords.map((kw) => (
                <Tag
                  key={kw}
                  closable
                  onClose={() => handleRemoveKeyword(kw)}
                  color="blue"
                >
                  {kw}
                </Tag>
              ))}
            </div>
            <Input
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onPressEnter={handleKeywordConfirm}
              placeholder="输入关键词后按回车添加"
              maxLength={20}
            />
          </div>

          {/* Delegates To */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">可委派 Agent</label>
            <Text className="text-xs text-gray-600 block mb-2">
              选择该 Agent 可以委派子任务的其他 Agent
            </Text>
            <Select
              mode="multiple"
              value={delegatesTo}
              onChange={(val) => setDelegatesTo(val)}
              placeholder="选择可委派的 Agent"
              className="w-full"
            >
              {allAgentTypes
                .filter((t) => t !== id) // prevent self-delegation
                .map((t) => (
                  <Select.Option key={t} value={t}>
                    {AGENT_NAMES[t as BuiltinAgentType] || t}
                  </Select.Option>
                ))}
            </Select>
          </div>

          {/* Subtask Prefix */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">子任务前缀</label>
            <TextArea
              value={subtaskPrefix}
              onChange={(e) => setSubtaskPrefix(e.target.value)}
              placeholder="作为XXX工程师，请对以下飞行器设计任务进行XXX分析："
              rows={2}
            />
          </div>

          {/* KB Tags */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">知识库限定标签</label>
            <Text className="text-xs text-gray-600 block mb-2">
              配置后，该 Agent 的 knowledge_search 工具只检索带这些标签的知识库文档；留空则检索全库。需先在知识库导入文档时打上对应标签。
            </Text>
            <Select
              mode="tags"
              value={kbTags}
              onChange={setKbTags}
              placeholder="如：安保（留空 = 检索全库）"
              className="w-full"
              options={availableKbTags.map((t) => ({ label: t, value: t }))}
            />
          </div>

          {/* Engine */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">LLM 引擎</label>
            <Select
              value={engine}
              onChange={(v: 'deepseek' | 'pi') => setEngine(v)}
              style={{ width: '100%' }}
            >
              <Select.Option value="deepseek">DeepSeek（LangChain 直连）</Select.Option>
              <Select.Option value="pi">Pi SDK（OpenAI-compatible）</Select.Option>
            </Select>
            {engine === 'pi' && (
              <div className="text-xs text-gray-500 mt-1">
                Pi 引擎默认启用原生工具（read/bash/grep/find/ls），所选临智工具（含 MCP / 委派）将作为 customTools 一并注入。
              </div>
            )}
          </div>

          {/* Model Name */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">模型名称</label>
            <Input
              value={modelName}
              onChange={(e) => setModelName(e.target.value)}
              placeholder="deepseek-chat"
            />
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              {isEditing ? '保存修改' : '创建 Agent'}
            </Button>
            {isBuiltin && isEditing && (
              <Popconfirm
                title="确定重置此内置 Agent 为默认配置？所有自定义修改将丢失。"
                onConfirm={handleReset}
                okText="重置"
                cancelText="取消"
              >
                <Button icon={<UndoOutlined />}>重置为默认</Button>
              </Popconfirm>
            )}
            <Button onClick={() => navigate('/agents')}>取消</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
