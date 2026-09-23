import { Button, Input, Segmented, Popconfirm, Tooltip, message } from 'antd'
import { ThunderboltOutlined, DeleteOutlined, SearchOutlined, ApartmentOutlined, NodeIndexOutlined } from '@ant-design/icons'
import type { WikiProgress } from '../../types/wiki'

interface WikiToolbarProps {
  hasWiki: boolean
  generating: boolean
  generateProgress: WikiProgress | null
  graphMode: 'overview' | 'ego'
  searchTerm: string
  onGenerate: () => void
  onDeleteAll: () => void
  onModeChange: (mode: 'overview' | 'ego') => void
  onSearchChange: (term: string) => void
}

export default function WikiToolbar({
  hasWiki,
  generating,
  generateProgress,
  graphMode,
  searchTerm,
  onGenerate,
  onDeleteAll,
  onModeChange,
  onSearchChange
}: WikiToolbarProps): JSX.Element {
  const progressPercent = generateProgress && generateProgress.total > 0
    ? Math.round((generateProgress.done / generateProgress.total) * 100)
    : 0

  return (
    <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-100 bg-white flex-shrink-0">
      {/* 生成/重新生成 */}
      <Tooltip title={hasWiki ? '基于已有实体重新生成 Wiki' : '从知识图谱实体生成互链知识页面'}>
        <Button
          type="primary"
          icon={<ThunderboltOutlined />}
          loading={generating}
          onClick={onGenerate}
          disabled={generating}
        >
          {hasWiki ? '重新生成' : '生成 Wiki'}
        </Button>
      </Tooltip>

      {/* 生成进度提示 */}
      {generating && generateProgress && (
        <span className="text-xs text-gray-500">
          {generateProgress.title} ({generateProgress.done}/{generateProgress.total}) {progressPercent}%
        </span>
      )}

      {/* 搜索 */}
      <Input
        size="small"
        allowClear
        prefix={<SearchOutlined />}
        placeholder="搜索页面..."
        value={searchTerm}
        onChange={(e) => onSearchChange(e.target.value)}
        className="w-48"
      />

      {/* 模式切换 */}
      {hasWiki && (
        <Segmented
          size="small"
          value={graphMode}
          onChange={(val) => onModeChange(val as 'overview' | 'ego')}
          options={[
            { label: '概览', value: 'overview', icon: <ApartmentOutlined /> },
            { label: '邻域', value: 'ego', icon: <NodeIndexOutlined /> }
          ]}
        />
      )}

      {/* 删除 */}
      {hasWiki && (
        <Popconfirm
          title="确定删除所有 Wiki 页面？"
          description="删除后需要重新生成"
          onConfirm={() => {
            onDeleteAll()
            message.success('已清除 Wiki')
          }}
          okText="删除"
          cancelText="取消"
          okButtonProps={{ danger: true }}
        >
          <Button size="small" danger icon={<DeleteOutlined />}>
            清除
          </Button>
        </Popconfirm>
      )}
    </div>
  )
}
