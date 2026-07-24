import { useState, useEffect } from 'react'
import { Input, Select, Button, message, Typography } from 'antd'
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate, useParams, useLocation } from 'react-router-dom'

const { TextArea } = Input
const { Text } = Typography

const AGENT_OPTIONS = [
  { value: 'orchestrator', label: 'Orchestrator' },
  { value: 'aero', label: 'Aero' },
  { value: 'structural', label: 'Structural' },
  { value: 'propulsion', label: 'Propulsion' },
  { value: 'avionics', label: 'Avionics' },
  { value: 'simulation', label: 'Simulation' },
  { value: 'documentation', label: 'Documentation' },
  { value: 'retriever', label: 'Retriever' }
]

const DEFAULT_CATEGORIES = ['气动分析', '总体设计', '结构强度', '推进设计', '航电控制', '文档输出', '仿真验证']

export default function TemplateEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const isEditing = Boolean(id)
  const navigate = useNavigate()
  const location = useLocation()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [customCategory, setCustomCategory] = useState('')
  const [promptTemplate, setPromptTemplate] = useState('')
  const [agentType, setAgentType] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)
  const [existingCategories, setExistingCategories] = useState<string[]>([])

  useEffect(() => {
    loadCategories()
    if (isEditing && id) {
      loadTemplate(id)
    } else {
      // 从"复制为自定义模板"跳转来的，预填内容
      const state = location.state as {
        name?: string
        description?: string
        category?: string
        promptTemplate?: string
        agentType?: string[]
      } | null
      if (state) {
        setName(state.name || '')
        setDescription(state.description || '')
        setCategory(state.category || '')
        setPromptTemplate(state.promptTemplate || '')
        setAgentType(state.agentType || [])
      }
    }
  }, [id])

  const loadCategories = async (): Promise<void> => {
    try {
      const cats = await window.aeromind.template.categories()
      setExistingCategories(cats.filter((c) => c !== '全部'))
    } catch { /* ignore */ }
  }

  const loadTemplate = async (templateId: string): Promise<void> => {
    setLoading(true)
    try {
      const template = await window.aeromind.template.get(templateId)
      if (!template) {
        message.error('模板不存在')
        navigate('/templates')
        return
      }
      if (template.is_builtin) {
        message.error('内置模板不可编辑')
        navigate('/templates')
        return
      }
      setName(template.name)
      setDescription(template.description || '')
      setCategory(template.category)
      setPromptTemplate(template.prompt_template)
      try {
        setAgentType(JSON.parse(template.agents || '[]'))
      } catch { setAgentType([]) }
    } catch {
      message.error('加载模板失败')
      navigate('/templates')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    if (!name.trim()) { message.warning('请输入模板名称'); return }
    const finalCategory = category === '__custom__' ? customCategory.trim() : category
    if (!finalCategory) { message.warning('请选择或输入分类'); return }
    if (!promptTemplate.trim()) { message.warning('请输入提示词模板'); return }

    setSaving(true)
    try {
      if (isEditing && id) {
        const result = await window.aeromind.template.update(id, {
          name: name.trim(),
          description: description.trim() || undefined,
          category: finalCategory,
          promptTemplate: promptTemplate.trim(),
          agentType
        })
        if (result.success) {
          message.success('模板已更新')
          navigate('/templates')
        } else {
          message.error(result.error || '更新失败')
        }
      } else {
        const template = await window.aeromind.template.create({
          name: name.trim(),
          description: description.trim() || undefined,
          category: finalCategory,
          promptTemplate: promptTemplate.trim(),
          agentType
        })
        if (template) {
          message.success('模板已创建')
          navigate('/templates')
        } else {
          message.error('创建失败')
        }
      }
    } catch (err: any) {
      message.error('保存失败: ' + (err.message || '未知错误'))
    } finally {
      setSaving(false)
    }
  }

  const allCategories = Array.from(new Set([...DEFAULT_CATEGORIES, ...existingCategories]))

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
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Button type="text" icon={<ArrowLeftOutlined />} onClick={() => navigate('/templates')} />
          <h2 className="text-lg font-semibold text-gray-900">
            {isEditing ? '编辑自定义模板' : '创建自定义模板'}
          </h2>
        </div>

        <div className="space-y-5">
          {/* Name */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">模板名称</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：机翼优化分析"
              maxLength={50}
              showCount
            />
          </div>

          {/* Description */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">模板描述</label>
            <TextArea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="简要描述该模板的功能和用途"
              rows={2}
              maxLength={200}
              showCount
            />
          </div>

          {/* Category */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">分类</label>
            <Select
              value={category || undefined}
              onChange={(val) => setCategory(val)}
              placeholder="选择分类"
              className="w-full"
              options={[
                ...allCategories.map((c) => ({ value: c, label: c })),
                { value: '__custom__', label: '自定义分类...' }
              ]}
            />
            {category === '__custom__' && (
              <Input
                className="mt-2"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                placeholder="输入自定义分类名称"
                maxLength={20}
              />
            )}
          </div>

          {/* Agent selection */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">关联 Agent</label>
            <Select
              mode="multiple"
              value={agentType}
              onChange={(val) => setAgentType(val)}
              placeholder="选择关联的 Agent（可多选）"
              className="w-full"
              options={AGENT_OPTIONS}
            />
          </div>

          {/* Prompt template */}
          <div>
            <label className="text-sm font-medium text-gray-900 mb-1 block">提示词模板</label>
            <Text className="text-xs text-gray-600 block mb-2">
              使用 {'{{变量名}}'} 语法定义可变参数，使用模板时会自动提示填写
            </Text>
            <TextArea
              value={promptTemplate}
              onChange={(e) => setPromptTemplate(e.target.value)}
              placeholder={'请对{{aircraft_type}}进行气动分析，巡航速度为{{cruise_speed}} km/h...'}
              rows={8}
              style={{ fontFamily: 'monospace' }}
            />
            {/* Show detected variables */}
            {promptTemplate && (() => {
              const vars = promptTemplate.match(/\{\{(\w+)\}\}/g)
              if (!vars || vars.length === 0) return null
              const uniqueVars = Array.from(new Set(vars.map((v) => v.replace(/\{\{|\}\}/g, ''))))
              return (
                <div className="mt-2">
                  <Text className="text-xs text-gray-600">检测到变量: </Text>
                  {uniqueVars.map((v) => (
                    <Text key={v} className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded mr-1">{`{{${v}}}`}</Text>
                  ))}
                </div>
              )
            })()}
          </div>

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <Button type="primary" icon={<SaveOutlined />} loading={saving} onClick={handleSave}>
              {isEditing ? '保存修改' : '创建模板'}
            </Button>
            <Button onClick={() => navigate('/templates')}>取消</Button>
          </div>
        </div>
      </div>
    </div>
  )
}
