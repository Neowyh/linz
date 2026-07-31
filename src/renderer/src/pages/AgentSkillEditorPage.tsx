import { useState, useEffect } from 'react'
import { Input, Select, Button, InputNumber, Switch, message, Typography, Spin, Card } from 'antd'
import { ArrowLeftOutlined, SaveOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { useAgentSkillStore } from '../stores/agentSkillStore'
import { BUILTIN_AGENT_TYPES } from '../types/agentSkill'

const { TextArea } = Input
const { Text } = Typography

export default function AgentSkillEditorPage(): JSX.Element {
  const { id } = useParams<{ id: string }>()
  const isEditing = Boolean(id) && id !== 'new'
  const navigate = useNavigate()
  const { createSkill, updateSkill } = useAgentSkillStore()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [content, setContent] = useState('')
  const [targetAgents, setTargetAgents] = useState<string[]>([])
  const [triggerKeywords, setTriggerKeywords] = useState<string[]>([])
  const [priority, setPriority] = useState(0)
  const [enabled, setEnabled] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (isEditing && id) {
      loadSkill(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function loadSkill(skillId: string): Promise<void> {
    setLoading(true)
    try {
      const skill = await window.aeromind.agentSkill.get(skillId)
      if (skill) {
        setName(skill.name)
        setDescription(skill.description || '')
        setContent(skill.content)
        setTargetAgents(skill.target_agents || [])
        setTriggerKeywords(skill.trigger_keywords || [])
        setPriority(skill.priority || 0)
        setEnabled(skill.enabled)
      }
    } catch (err) {
      message.error('加载技能失败')
    } finally {
      setLoading(false)
    }
  }

  async function handleSave(): Promise<void> {
    if (!name.trim()) {
      message.warning('请输入技能名称')
      return
    }
    if (!content.trim()) {
      message.warning('请输入技能内容')
      return
    }
    setSaving(true)
    try {
      const params = {
        name: name.trim(),
        description: description.trim(),
        content,
        targetAgents,
        triggerKeywords,
        priority,
        enabled
      }
      const result = isEditing
        ? await updateSkill(id!, params as Record<string, unknown>)
        : await createSkill(params)
      if (result.success) {
        message.success(isEditing ? '技能已更新' : '技能已创建')
        navigate('/agents')
      } else {
        message.error(result.error || '保存失败')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin />
      </div>
    )
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <Button
            type="text"
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/agents')}
          >
            返回 Agent 管理
          </Button>
          <div className="flex items-center gap-2">
            <Text type="secondary" className="text-sm">启用</Text>
            <Switch checked={enabled} onChange={setEnabled} />
            <Button
              type="primary"
              icon={<SaveOutlined />}
              loading={saving}
              onClick={handleSave}
            >
              保存
            </Button>
          </div>
        </div>

        <Card title={isEditing ? '编辑技能' : '创建技能'} className="shadow-sm">
          <div className="space-y-4">
            <div>
              <Text className="block mb-1 text-sm">名称 *</Text>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="例如：翼型分析流程"
                maxLength={50}
              />
            </div>

            <div>
              <Text className="block mb-1 text-sm">描述</Text>
              <TextArea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="简短描述技能用途"
                rows={2}
                maxLength={200}
              />
            </div>

            <div>
              <Text className="block mb-1 text-sm">目标 Agent</Text>
              <Select
                mode="multiple"
                placeholder="留空 = 适用所有 Agent"
                value={targetAgents}
                onChange={setTargetAgents}
                className="w-full"
                options={BUILTIN_AGENT_TYPES.map((a) => ({ value: a.value, label: a.label }))}
              />
              <Text type="secondary" className="text-xs mt-1 block">
                不选表示对所有 Agent 生效；选择多个表示只对这些 Agent 生效
              </Text>
            </div>

            <div>
              <Text className="block mb-1 text-sm">触发关键词</Text>
              <Select
                mode="tags"
                placeholder="留空 = 始终启用；输入关键词后回车添加"
                value={triggerKeywords}
                onChange={setTriggerKeywords}
                className="w-full"
                tokenSeparators={[',', ' ']}
              />
              <Text type="secondary" className="text-xs mt-1 block">
                不填表示该 Agent 运行时始终注入此技能；填了关键词后，仅当任务文本命中任一关键词（大小写不敏感）时才注入
              </Text>
            </div>

            <div>
              <Text className="block mb-1 text-sm">内容 *</Text>
              <TextArea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder={
                  '用 Markdown 描述"遇到此类任务该怎么做"的过程性知识，例如：\n\n' +
                  '## 分析步骤\n1. 确认翼型编号（如 NACA 2412）\n2. 估算雷诺数 ...\n3. 调用 XFOIL 工具 ...\n4. 分析 Cl/Cd 曲线\n5. 输出失速特性'
                }
                rows={12}
                className="font-mono text-sm"
              />
              <div className="flex items-center justify-between mt-1">
                <Text type="secondary" className="text-xs">
                  这是真正注入到 Agent 系统提示词的过程性知识，会告诉 Agent 遇到匹配任务时该按什么步骤执行
                </Text>
                <Text
                  className="text-xs flex-shrink-0 ml-2"
                  type={content.length > 8000 ? 'danger' : 'secondary'}
                >
                  {content.length} 字{content.length > 8000 ? '，过长会显著增加每次调用的 token 消耗' : ''}
                </Text>
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div>
                <Text className="block mb-1 text-sm">优先级</Text>
                <InputNumber
                  value={priority}
                  onChange={(v) => setPriority(v ?? 0)}
                  min={-100}
                  max={100}
                  className="w-32"
                />
              </div>
              <Text type="secondary" className="text-xs mt-6">
                多个技能同时命中时，按优先级降序注入
              </Text>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
