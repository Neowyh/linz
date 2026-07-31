import { useEffect, useState } from 'react'
import {
  Button, Card, Tag, Empty, Popconfirm, Switch, message, Spin, Tooltip, Modal, Typography, Dropdown
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ThunderboltOutlined, EyeOutlined,
  ImportOutlined, DownOutlined, CopyOutlined, DownloadOutlined
} from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { useAgentSkillStore } from '../stores/agentSkillStore'
import { BUILTIN_AGENT_TYPES } from '../types/agentSkill'
import type { AgentSkillData } from '../types/agentSkill'
import ImportSkillsModal, { type SkillImportCandidate } from './ImportSkillsModal'

const AGENT_LABEL: Record<string, string> = BUILTIN_AGENT_TYPES.reduce(
  (acc, item) => {
    acc[item.value] = item.label
    return acc
  },
  {} as Record<string, string>
)

export default function AgentSkillsTab(): JSX.Element {
  const navigate = useNavigate()
  const {
    skills, loading, fetchSkills, deleteSkill, toggleSkill, createSkill
  } = useAgentSkillStore()
  const [viewSkill, setViewSkill] = useState<AgentSkillData | null>(null)
  const [importOpen, setImportOpen] = useState(false)
  const [importCandidates, setImportCandidates] = useState<SkillImportCandidate[]>([])
  const [importErrors, setImportErrors] = useState<string[]>([])
  const [importParsing, setImportParsing] = useState(false)

  useEffect(() => {
    fetchSkills()
  }, [fetchSkills])

  async function handleImportPick(kind: 'file' | 'folder'): Promise<void> {
    const paths = kind === 'file'
      ? await window.aeromind.agentSkill.importPick()
      : await window.aeromind.agentSkill.importPickFolder()
    if (!paths || paths.length === 0) return

    setImportParsing(true)
    try {
      const { candidates, errors } = await window.aeromind.agentSkill.importParse(paths)
      if (candidates.length === 0) {
        message.warning(errors.length > 0 ? errors[0] : '未在所选来源中找到可导入的技能（SKILL.md）')
        if (errors.length > 1) {
          Modal.warning({ title: '解析失败详情', content: errors.join('\n') })
        }
        return
      }
      setImportCandidates(candidates)
      setImportErrors(errors)
      setImportOpen(true)
    } catch (err: any) {
      message.error(err?.message || '解析失败')
    } finally {
      setImportParsing(false)
    }
  }

  async function handleDuplicate(skill: AgentSkillData): Promise<void> {
    const result = await createSkill({
      name: `${skill.name}（副本）`,
      description: skill.description || '',
      content: skill.content,
      targetAgents: skill.target_agents || [],
      triggerKeywords: skill.trigger_keywords || [],
      priority: skill.priority
    })
    if (result.success) {
      message.success(`已复制为自定义技能「${skill.name}（副本）」`)
    } else {
      message.error(result.error || '复制失败')
    }
  }

  async function handleExport(skill: AgentSkillData): Promise<void> {
    const result = await window.aeromind.agentSkill.exportSkill(skill.id)
    if (result.success) {
      message.success(`已导出到 ${result.filePath}`)
    } else if (!result.canceled) {
      message.error(result.error || '导出失败')
    }
  }

  async function handleDelete(id: string, name: string): Promise<void> {
    const result = await deleteSkill(id)
    if (result.success) {
      message.success(`已删除技能「${name}」`)
    } else {
      message.error(result.error || '删除失败')
    }
  }

  async function handleToggle(id: string, name: string, enabled: boolean): Promise<void> {
    const result = await toggleSkill(id, enabled)
    if (result.success) {
      message.success(`已${enabled ? '启用' : '禁用'}技能「${name}」`)
    } else {
      message.error(result.error || '操作失败')
    }
  }

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-600">
          技能（过程性知识）会在 Agent 运行时自动注入到其系统提示词，告诉它"遇到 X 该怎么做"
        </div>
        <div className="flex items-center gap-2">
          <Dropdown
            menu={{
              items: [
                { key: 'file', label: '从文件导入（.md / .zip）', onClick: () => handleImportPick('file') },
                { key: 'folder', label: '从文件夹导入', onClick: () => handleImportPick('folder') }
              ]
            }}
            trigger={['click']}
          >
            <Button icon={<ImportOutlined />} loading={importParsing}>
              导入技能 <DownOutlined style={{ fontSize: 10 }} />
            </Button>
          </Dropdown>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/agent-skills/new')}
          >
            创建技能
          </Button>
        </div>
      </div>

      {loading && skills.length === 0 ? (
        <div className="text-center py-8">
          <Spin />
        </div>
      ) : skills.length === 0 ? (
        <Empty description="暂无技能，点击「创建技能」添加">
          <Button type="primary" icon={<PlusOutlined />} onClick={() => navigate('/agent-skills/new')}>
            创建技能
          </Button>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {skills.map((skill) => {
            const targets = skill.target_agents || []
            const keywords = skill.trigger_keywords || []
            const allAgents = targets.length === 0
            const alwaysOn = keywords.length === 0
            return (
              <Card
                key={skill.id}
                size="small"
                className="shadow-sm hover:shadow-md transition-shadow"
                title={
                  <div className="flex items-center gap-2">
                    <ThunderboltOutlined style={{ color: '#722ED1' }} />
                    <span className="text-sm font-medium">{skill.name}</span>
                    {skill.is_builtin && (
                      <Tag color="gold" style={{ fontSize: 10 }}>内置</Tag>
                    )}
                    {!skill.enabled && (
                      <Tag style={{ fontSize: 10 }}>已禁用</Tag>
                    )}
                  </div>
                }
                extra={
                  <Switch
                    size="small"
                    checked={skill.enabled}
                    onChange={(checked) => handleToggle(skill.id, skill.name, checked)}
                  />
                }
              >
                <p className="text-xs text-gray-600 mb-2 line-clamp-2 min-h-[2em]">
                  {skill.description || '（无描述）'}
                </p>

                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-xs text-gray-500 mr-1">目标 Agent:</span>
                  {allAgents ? (
                    <Tag color="purple" style={{ fontSize: 10 }}>全部</Tag>
                  ) : (
                    targets.map((t) => (
                      <Tag key={t} color="blue" style={{ fontSize: 10 }}>
                        {AGENT_LABEL[t] || t}
                      </Tag>
                    ))
                  )}
                </div>

                <div className="flex flex-wrap gap-1 mb-2">
                  <span className="text-xs text-gray-500 mr-1">触发关键词:</span>
                  {alwaysOn ? (
                    <Tag color="green" style={{ fontSize: 10 }}>始终启用</Tag>
                  ) : (
                    keywords.map((k) => (
                      <Tag key={k} style={{ fontSize: 10 }}>{k}</Tag>
                    ))
                  )}
                </div>

                {skill.priority !== 0 && (
                  <div className="text-xs text-gray-400 mb-2">优先级: {skill.priority}</div>
                )}

                <div className="flex items-center justify-end mt-2">
                  <div className="flex gap-1">
                    <Tooltip title="查看技能内容">
                      <Button
                        type="text"
                        size="small"
                        icon={<EyeOutlined />}
                        onClick={() => setViewSkill(skill)}
                      />
                    </Tooltip>
                    {skill.is_builtin ? (
                      <Tooltip title="另存为自定义技能（可复制后修改）">
                        <Button
                          type="text"
                          size="small"
                          icon={<CopyOutlined />}
                          onClick={() => handleDuplicate(skill)}
                        />
                      </Tooltip>
                    ) : (
                      <>
                        <Tooltip title="导出为 SKILL.md">
                          <Button
                            type="text"
                            size="small"
                            icon={<DownloadOutlined />}
                            onClick={() => handleExport(skill)}
                          />
                        </Tooltip>
                        <Tooltip title="编辑">
                          <Button
                            type="text"
                            size="small"
                            icon={<EditOutlined />}
                            onClick={() => navigate(`/agent-skills/${skill.id}/edit`)}
                          />
                        </Tooltip>
                        <Popconfirm
                          title={`确定删除技能「${skill.name}」？`}
                          onConfirm={() => handleDelete(skill.id, skill.name)}
                          okText="删除"
                          cancelText="取消"
                        >
                          <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                        </Popconfirm>
                      </>
                    )}
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* 技能查看弹窗（只读，内置技能亦可查看） */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <ThunderboltOutlined style={{ color: '#722ED1' }} />
            <span>{viewSkill?.name}</span>
            {viewSkill?.is_builtin ? (
              <Tag color="gold" style={{ fontSize: 10 }}>内置</Tag>
            ) : (
              <Tag color="green" style={{ fontSize: 10 }}>自定义</Tag>
            )}
            {viewSkill && !viewSkill.enabled && (
              <Tag style={{ fontSize: 10 }}>已禁用</Tag>
            )}
          </div>
        }
        open={!!viewSkill}
        onCancel={() => setViewSkill(null)}
        footer={<Button onClick={() => setViewSkill(null)}>关闭</Button>}
        width={680}
      >
        {viewSkill && (
          <div className="py-2 space-y-4">
            <div>
              <Typography.Text type="secondary" className="text-xs">描述</Typography.Text>
              <p className="text-sm text-gray-800 mt-1">{viewSkill.description || '无'}</p>
            </div>
            <div>
              <Typography.Text type="secondary" className="text-xs">目标 Agent</Typography.Text>
              <div className="flex gap-1 flex-wrap mt-1">
                {(viewSkill.target_agents || []).length === 0 ? (
                  <Tag color="purple" style={{ fontSize: 10 }}>全部</Tag>
                ) : (
                  viewSkill.target_agents.map((t) => (
                    <Tag key={t} color="blue" style={{ fontSize: 10 }}>{AGENT_LABEL[t] || t}</Tag>
                  ))
                )}
              </div>
            </div>
            <div>
              <Typography.Text type="secondary" className="text-xs">触发关键词</Typography.Text>
              <div className="flex gap-1 flex-wrap mt-1">
                {(viewSkill.trigger_keywords || []).length === 0 ? (
                  <Tag color="green" style={{ fontSize: 10 }}>始终启用</Tag>
                ) : (
                  viewSkill.trigger_keywords.map((k) => (
                    <Tag key={k} style={{ fontSize: 10 }}>{k}</Tag>
                  ))
                )}
              </div>
            </div>
            {viewSkill.priority !== 0 && (
              <div>
                <Typography.Text type="secondary" className="text-xs">优先级</Typography.Text>
                <p className="text-sm text-gray-800 mt-1">{viewSkill.priority}</p>
              </div>
            )}
            <div>
              <Typography.Text type="secondary" className="text-xs block mb-1">技能内容（运行时注入 Agent 系统提示词）</Typography.Text>
              <pre className="text-xs text-gray-800 bg-gray-50 rounded p-3 max-h-80 overflow-auto whitespace-pre-wrap break-words font-mono">
                {viewSkill.content}
              </pre>
            </div>
          </div>
        )}
      </Modal>
      {/* 技能导入预览弹窗 */}
      <ImportSkillsModal
        open={importOpen}
        candidates={importCandidates}
        errors={importErrors}
        onClose={() => setImportOpen(false)}
        onImported={fetchSkills}
      />
    </div>
  )
}
