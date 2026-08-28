import { useEffect, useState } from 'react'
import { Modal, Button, Checkbox, Input, Tag, Alert, Typography, message } from 'antd'
import { RobotOutlined, WarningOutlined } from '@ant-design/icons'

// 与主进程 custom-agents.service.ts 的 AgentImportCandidate 对应
export interface AgentImportCandidate {
  name: string
  description: string | null
  color: string
  icon: string
  system_prompt: string
  tools: string[]
  keywords: string[]
  delegates_to: string[]
  subtask_prefix: string | null
  model_name: string
  engine: string
  kb_tags: string[]
  duplicate: boolean
  warnings: string[]
  sourceLabel: string
}

interface EditableCandidate extends AgentImportCandidate {
  checked: boolean
  editedName: string
  editedKeywords: string[]
}

interface ImportAgentsModalProps {
  open: boolean
  candidates: AgentImportCandidate[]
  errors: string[]
  onClose: () => void
  onImported: () => void
}

const { Text } = Typography

export default function ImportAgentsModal({ open, candidates, errors, onClose, onImported }: ImportAgentsModalProps): JSX.Element {
  const [items, setItems] = useState<EditableCandidate[]>([])
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (open) {
      setItems(
        candidates.map((c) => ({
          ...c,
          checked: true,
          editedName: c.name,
          editedKeywords: c.keywords
        }))
      )
    }
  }, [open, candidates])

  const checkedCount = items.filter((i) => i.checked).length

  const updateItem = (index: number, patch: Partial<EditableCandidate>): void => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)))
  }

  const handleImport = async (): Promise<void> => {
    const selected = items.filter((i) => i.checked)
    if (selected.length === 0) return
    if (selected.some((i) => !i.editedName.trim())) {
      message.warning('Agent 名称不能为空')
      return
    }
    setImporting(true)
    try {
      const result = await window.aeromind.customAgent.importConfirm(
        selected.map((i) => ({
          ...i,
          name: i.editedName.trim(),
          keywords: i.editedKeywords
        }))
      )
      if (result.imported > 0) {
        const hadDuplicate = selected.some((i) => i.duplicate)
        message.success(`已导入 ${result.imported} 个 Agent${hadDuplicate ? '（重名 Agent 已自动加后缀）' : ''}`)
        if (result.errors && result.errors.length > 0) {
          // 部分失败：继续显示已导入部分，但提示失败项
          setImportErrors(result.errors)
          message.warning(`${result.errors.length} 个 Agent 导入失败，详见上方提示`)
        } else {
          onImported()
          onClose()
        }
      } else if (result.errors && result.errors.length > 0) {
        message.error(result.errors.join('；'))
      } else {
        message.error('导入失败')
      }
    } catch (err: any) {
      message.error(err?.message || '导入失败')
    } finally {
      setImporting(false)
    }
  }

  return (
    <Modal
      title={
        <div className="flex items-center gap-2">
          <RobotOutlined style={{ color: '#1E6FCC' }} />
          <span>导入 Agent 预览</span>
          <Tag color="blue">{items.length} 个 Agent</Tag>
        </div>
      }
      open={open}
      onCancel={onClose}
      width={720}
      footer={[
        <Button key="cancel" onClick={onClose}>取消</Button>,
        <Button
          key="import"
          type="primary"
          loading={importing}
          disabled={checkedCount === 0}
          onClick={handleImport}
        >
          导入所选（{checkedCount}）
        </Button>
      ]}
    >
      <div className="py-2">
        {errors.length > 0 && (
          <Alert
            type="warning"
            showIcon
            className="mb-3"
            message="部分文件解析失败"
            description={
              <ul className="list-disc pl-4 text-xs">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            }
          />
        )}
        <Text type="secondary" className="text-xs block mb-3">
          导入后 Agent 立即生效并出现在 Agent 列表。关键词决定协调器何时调度该 Agent；清空表示不会自动调度（仍可手动委派）。
        </Text>
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {items.map((item, idx) => (
            <div
              key={`${item.sourceLabel}-${idx}`}
              className={`border rounded-lg p-3 ${item.checked ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200'}`}
            >
              <div className="flex items-center gap-2 mb-2">
                <Checkbox
                  checked={item.checked}
                  onChange={(e) => updateItem(idx, { checked: e.target.checked })}
                />
                <Input
                  size="small"
                  value={item.editedName}
                  onChange={(e) => updateItem(idx, { editedName: e.target.value })}
                  className="max-w-[260px]"
                  placeholder="Agent 名称"
                />
                {item.duplicate && (
                  <Tag color="orange" style={{ fontSize: 10 }}>与现有 Agent 重名，导入时自动加后缀</Tag>
                )}
                <Tag color="blue" style={{ fontSize: 10 }}>{item.engine}</Tag>
                <Tag style={{ fontSize: 10 }}>{item.model_name}</Tag>
              </div>
              {item.description && (
                <p className="text-xs text-gray-600 mb-2 line-clamp-2">{item.description}</p>
              )}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-500 flex-shrink-0">关键词:</span>
                <Input
                  size="small"
                  className="flex-1"
                  placeholder="逗号分隔，留空表示不自动调度"
                  value={item.editedKeywords.join(', ')}
                  onChange={(e) => updateItem(idx, {
                    editedKeywords: e.target.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean)
                  })}
                />
              </div>
              {item.tools.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  <span className="text-[10px] text-gray-500">工具:</span>
                  {item.tools.map((t) => (
                    <Tag key={t} color="blue" style={{ fontSize: 10 }}>{t}</Tag>
                  ))}
                </div>
              )}
              {item.delegates_to.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-1">
                  <span className="text-[10px] text-gray-500">委派:</span>
                  {item.delegates_to.map((d) => (
                    <Tag key={d} style={{ fontSize: 10 }}>{d}</Tag>
                  ))}
                </div>
              )}
              <div className="flex items-center justify-between mt-1">
                <Text type="secondary" className="text-[10px] truncate max-w-[70%]" title={item.sourceLabel}>
                  来源: {item.sourceLabel}
                </Text>
              </div>
              {item.warnings.length > 0 && (
                <div className="mt-1 space-y-0.5">
                  {item.warnings.map((w, i) => (
                    <div key={i} className="text-[10px] text-amber-600 flex items-center gap-1">
                      <WarningOutlined style={{ fontSize: 10 }} />
                      <span>{w}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  )
}
