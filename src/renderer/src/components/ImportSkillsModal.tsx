import { useEffect, useState } from 'react'
import { Modal, Button, Checkbox, Input, Select, Tag, Alert, Typography, message } from 'antd'
import { ThunderboltOutlined, WarningOutlined } from '@ant-design/icons'

// 与主进程 skill-import.service.ts 的 SkillCandidate 对应
export interface SkillImportCandidate {
  sourcePath: string
  name: string
  description: string
  content: string
  suggestedKeywords: string[]
  warnings: string[]
  duplicate: boolean
  packageSource?: { kind: 'dir'; dir: string } | { kind: 'zip'; zipPath: string; prefix: string }
  scriptNames: string[]
}

interface EditableCandidate extends SkillImportCandidate {
  checked: boolean
  editedName: string
  editedKeywords: string[]
}

interface ImportSkillsModalProps {
  open: boolean
  candidates: SkillImportCandidate[]
  errors: string[]
  onClose: () => void
  onImported: () => void
}

const { Text } = Typography

export default function ImportSkillsModal({ open, candidates, errors, onClose, onImported }: ImportSkillsModalProps): JSX.Element {
  const [items, setItems] = useState<EditableCandidate[]>([])
  const [importing, setImporting] = useState(false)

  useEffect(() => {
    if (open) {
      setItems(
        candidates.map((c) => ({
          ...c,
          checked: true,
          editedName: c.name,
          editedKeywords: c.suggestedKeywords
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
      message.warning('技能名称不能为空')
      return
    }
    setImporting(true)
    try {
      const result = await window.aeromind.agentSkill.importConfirm(
        selected.map((i) => ({
          name: i.editedName.trim(),
          description: i.description,
          content: i.content,
          triggerKeywords: i.editedKeywords,
          packageSource: i.packageSource
        }))
      )
      if (result.success) {
        const hadDuplicate = selected.some((i) => i.duplicate)
        message.success(`已导入 ${result.imported} 个技能${hadDuplicate ? '（重名技能已自动加后缀）' : ''}`)
        onImported()
        onClose()
      } else {
        message.error(result.error || '导入失败')
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
          <ThunderboltOutlined style={{ color: '#722ED1' }} />
          <span>导入技能预览</span>
          <Tag color="purple">{items.length} 个技能</Tag>
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
            message="部分来源解析失败"
            description={
              <ul className="list-disc pl-4 text-xs">
                {errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            }
          />
        )}
        <Text type="secondary" className="text-xs block mb-3">
          触发关键词决定技能何时自动注入（任务文本命中任一关键词时注入）；清空表示始终启用。导入后可在编辑器中调整目标 Agent 等配置。
        </Text>
        <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
          {items.map((item, idx) => (
            <div
              key={`${item.sourcePath}-${idx}`}
              className={`border rounded-lg p-3 ${item.checked ? 'border-purple-200 bg-purple-50/30' : 'border-gray-200'}`}
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
                  placeholder="技能名称"
                />
                {item.duplicate && (
                  <Tag color="orange" style={{ fontSize: 10 }}>与现有技能重名，导入时自动加后缀</Tag>
                )}
              </div>
              {item.description && (
                <p className="text-xs text-gray-600 mb-2 line-clamp-2">{item.description}</p>
              )}
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs text-gray-500 flex-shrink-0">触发关键词:</span>
                <Select
                  mode="tags"
                  size="small"
                  className="flex-1"
                  placeholder="留空 = 始终启用"
                  value={item.editedKeywords}
                  onChange={(v) => updateItem(idx, { editedKeywords: v })}
                  tokenSeparators={[',', ' ']}
                />
              </div>
              <div className="flex items-center justify-between mt-1">
                <Text type="secondary" className="text-[10px] truncate max-w-[70%]" title={item.sourcePath}>
                  来源: {item.sourcePath}
                </Text>
                <span className="text-[10px] text-gray-400">{item.content.length} 字</span>
              </div>
              {item.scriptNames.length > 0 && (
                <div className="mt-1 text-[10px] text-blue-600">
                  附带脚本: {item.scriptNames.join('、')}（导入后 Agent 可通过 run_skill_script 工具执行）
                </div>
              )}
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
