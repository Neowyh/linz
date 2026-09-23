import { useState, useEffect } from 'react'
import { Tabs, Tag, Button, Rate, Empty, Modal, Input, message, Popconfirm, Typography } from 'antd'
import { AppstoreOutlined, ThunderboltOutlined, PlusOutlined, EditOutlined, DeleteOutlined, EyeOutlined, CopyOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useChatStore } from '../stores/chatStore'
import { AGENT_ICONS } from '../types/agent'
import AgentIcon from '../components/AgentIcon'
import { parseStringArray } from '../utils/text'

interface TemplateData {
  id: string
  name: string
  category: string
  description: string | null
  prompt_template: string
  agents: string
  input_params: string
  output_format: string
  is_builtin: number
  is_custom: number
  usage_count: number
  rating: number
  created_at: string
}

const CATEGORY_COLORS: Record<string, string> = {
  '气动分析': 'blue',
  '总体设计': 'purple',
  '结构强度': 'orange',
  '推进设计': 'red',
  '航电控制': 'cyan',
  '文档输出': 'green',
  '仿真验证': 'geekblue'
}

export default function TemplatesPage(): JSX.Element {
  const [templates, setTemplates] = useState<TemplateData[]>([])
  const [categories, setCategories] = useState<string[]>(['全部'])
  const [activeCategory, setActiveCategory] = useState('全部')
  const [loading, setLoading] = useState(true)
  const [templateModal, setTemplateModal] = useState<TemplateData | null>(null)
  const [paramValues, setParamValues] = useState<Record<string, string>>({})
  const [viewTemplate, setViewTemplate] = useState<TemplateData | null>(null)
  const navigate = useNavigate()
  const setPendingInput = useChatStore((s) => s.setPendingInput)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async (): Promise<void> => {
    setLoading(true)
    try {
      const [templateList, cats] = await Promise.all([
        window.aeromind.template.list(activeCategory !== '全部' ? activeCategory : undefined),
        window.aeromind.template.categories()
      ])
      setTemplates(templateList)
      setCategories(cats)
    } catch {
      message.error('加载模板数据失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [activeCategory])

  const handleUseTemplate = async (template: TemplateData): Promise<void> => {
    let params: any[] = []
    try {
      params = JSON.parse(template.input_params || '[]')
    } catch { /* ignore */ }

    if (params.length > 0) {
      setTemplateModal(template)
      const defaults: Record<string, string> = {}
      params.forEach((p: any) => { defaults[p.key] = p.default || '' })
      setParamValues(defaults)
    } else {
      await executeTemplate(template, {})
    }
  }

  const executeTemplate = async (template: TemplateData, values: Record<string, string>): Promise<void> => {
    let prompt = template.prompt_template
    // 模板占位符两种约定并存：内置模板用 {key}，自定义模板用 {{key}}
    // 先替换双花括号形式，再替换单花括号形式
    for (const [key, value] of Object.entries(values)) {
      prompt = prompt
        .replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
        .replace(new RegExp(`\\{${key}\\}`, 'g'), value)
    }

    await window.aeromind.template.use(template.id)
    const conv = await window.aeromind.conversation.create(template.name)
    setTemplateModal(null)

    // 预填到对话框，等待用户确认后发送（不自动发送）
    setPendingInput(prompt)
    navigate(`/chat/${conv.id}`)
    message.success(`已加载模板「${template.name}」，可在对话框中编辑后发送`)
  }

  const handleDeleteTemplate = async (id: string): Promise<void> => {
    try {
      const result = await window.aeromind.template.delete(id)
      if (result.success) {
        message.success('模板已删除')
        loadData()
      } else {
        message.error(result.error || '删除失败')
      }
    } catch {
      message.error('删除失败')
    }
  }

  const parseAgents = (agentsStr: string): string[] => parseStringArray(agentsStr)

  const parseInputParams = (paramsStr: string): any[] => {
    try { return JSON.parse(paramsStr || '[]') } catch { return [] }
  }

  const handleCopyAsCustom = (template: TemplateData): void => {
    setViewTemplate(null)
    navigate('/templates/new', {
      state: {
        name: `${template.name}（副本）`,
        description: template.description || '',
        category: template.category,
        promptTemplate: template.prompt_template,
        agentType: parseAgents(template.agents)
      }
    })
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-900">模板广场</h2>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/templates/new')}
          >
            创建模板
          </Button>
        </div>

        {/* 分类标签 */}
        <Tabs
          activeKey={activeCategory}
          onChange={setActiveCategory}
          items={categories.map((cat) => ({
            key: cat,
            label: cat
          }))}
        />

        {/* 模板列表 */}
        {loading ? (
          <div className="text-center py-8 text-gray-600">加载中...</div>
        ) : templates.length === 0 ? (
          <Empty description="暂无模板" />
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            {templates.map((template) => (
              <div key={template.id} className="bg-white rounded-card border border-line-light p-4 shadow-card hover:shadow-card-hover hover:-translate-y-0.5 transition-all">
                <div className="flex items-start justify-between mb-2">
                  <h4 className="text-sm font-medium text-gray-900">{template.name}</h4>
                  <div className="flex items-center gap-1">
                    {template.is_builtin ? (
                      <Tag color="gold" className="text-xs" style={{ fontSize: 10 }}>内置</Tag>
                    ) : (
                      <Tag color="green" className="text-xs" style={{ fontSize: 10 }}>自定义</Tag>
                    )}
                    <Tag color={CATEGORY_COLORS[template.category] || 'default'} className="text-xs">
                      {template.category}
                    </Tag>
                  </div>
                </div>
                <p className="text-xs text-gray-600 mb-3 line-clamp-2">{template.description}</p>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Rate disabled defaultValue={template.rating} allowHalf count={5} className="text-xs" style={{ fontSize: 10 }} />
                    <span className="text-xs text-gray-300">{template.usage_count}人使用</span>
                  </div>
                  <Button
                    type="primary"
                    size="small"
                    icon={<ThunderboltOutlined />}
                    onClick={() => handleUseTemplate(template)}
                  >
                    使用
                  </Button>
                </div>
                {/* 涉及的 Agent + 模板操作 */}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex gap-1 flex-wrap">
                    {parseAgents(template.agents).map((agentType: string) => (
                      <Tag key={agentType} className="text-xs inline-flex items-center gap-1" style={{ fontSize: 10 }}>
                        <AgentIcon icon={AGENT_ICONS[agentType] || 'assets/icons/orchestrator.svg'} className="w-3.5 h-3.5" />
                        {agentType}
                      </Tag>
                    ))}
                  </div>
                  <div className="flex gap-1">
                    <Button
                      type="text"
                      size="small"
                      icon={<EyeOutlined />}
                      onClick={() => setViewTemplate(template)}
                    />
                    {!template.is_builtin && (
                      <>
                        <Button
                          type="text"
                          size="small"
                          icon={<EditOutlined />}
                          onClick={() => navigate(`/templates/${template.id}/edit`)}
                        />
                        <Popconfirm
                          title="确定删除此自定义模板？"
                          onConfirm={() => handleDeleteTemplate(template.id)}
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
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 模板参数填写弹窗 */}
      <Modal
        title={templateModal?.name}
        open={!!templateModal}
        onCancel={() => setTemplateModal(null)}
        onOk={() => templateModal && executeTemplate(templateModal, paramValues)}
        okText="开始分析"
        width={480}
      >
        {templateModal && (
          <div className="py-2">
            <p className="text-sm text-gray-600 mb-4">{templateModal.description}</p>
            {(() => {
              let params: any[] = []
              try { params = JSON.parse(templateModal.input_params || '[]') } catch { /* ignore */ }
              return params.map((p: any) => (
                <div key={p.key} className="mb-3">
                  <label className="text-xs text-gray-600 mb-1 block">{p.label}</label>
                  <Input
                    value={paramValues[p.key] || ''}
                    onChange={(e) => setParamValues({ ...paramValues, [p.key]: e.target.value })}
                    placeholder={p.default || ''}
                  />
                </div>
              ))
            })()}
          </div>
        )}
      </Modal>
      {/* 模板查看弹窗（只读，内置模板亦可查看） */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <span>{viewTemplate?.name}</span>
            {viewTemplate?.is_builtin ? (
              <Tag color="gold" style={{ fontSize: 10 }}>内置</Tag>
            ) : (
              <Tag color="green" style={{ fontSize: 10 }}>自定义</Tag>
            )}
            {viewTemplate && (
              <Tag color={CATEGORY_COLORS[viewTemplate.category] || 'default'} style={{ fontSize: 10 }}>
                {viewTemplate.category}
              </Tag>
            )}
          </div>
        }
        open={!!viewTemplate}
        onCancel={() => setViewTemplate(null)}
        footer={
          viewTemplate && (
            <div className="flex justify-end gap-2">
              <Button onClick={() => setViewTemplate(null)}>关闭</Button>
              <Button
                type="primary"
                icon={<CopyOutlined />}
                onClick={() => handleCopyAsCustom(viewTemplate)}
              >
                复制为自定义模板
              </Button>
            </div>
          )
        }
        width={680}
      >
        {viewTemplate && (
          <div className="py-2 space-y-4">
            <div>
              <Typography.Text type="secondary" className="text-xs">描述</Typography.Text>
              <p className="text-sm text-gray-800 mt-1">{viewTemplate.description || '无'}</p>
            </div>
            <div>
              <Typography.Text type="secondary" className="text-xs">关联 Agent</Typography.Text>
              <div className="flex gap-1 flex-wrap mt-1">
                {parseAgents(viewTemplate.agents).length > 0 ? (
                  parseAgents(viewTemplate.agents).map((agentType: string) => (
                    <Tag key={agentType} className="text-xs">{agentType}</Tag>
                  ))
                ) : (
                  <Typography.Text type="secondary" className="text-xs">无</Typography.Text>
                )}
              </div>
            </div>
            {parseInputParams(viewTemplate.input_params).length > 0 && (
              <div>
                <Typography.Text type="secondary" className="text-xs">输入参数</Typography.Text>
                <div className="flex gap-1 flex-wrap mt-1">
                  {parseInputParams(viewTemplate.input_params).map((p: any) => (
                    <Tag key={p.key} color="blue" className="text-xs">{`{{${p.key}}}`}</Tag>
                  ))}
                </div>
              </div>
            )}
            <div>
              <Typography.Text type="secondary" className="text-xs block mb-1">提示词模板</Typography.Text>
              <pre className="text-xs text-gray-800 bg-gray-50 rounded p-3 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono">
                {viewTemplate.prompt_template}
              </pre>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
