import { Input, Button, Tooltip, Progress } from 'antd'
import { SearchOutlined, ReloadOutlined, CameraOutlined, ThunderboltOutlined, ClearOutlined } from '@ant-design/icons'
import { useKnowledgeGraphStore } from '../../stores/knowledgeGraphStore'

interface GraphToolbarProps {
  onRelayout: () => void
  onExportPng: () => void
  onEnrichSelected: () => void
  onClearEnrichment: () => void
}

export default function GraphToolbar({
  onRelayout,
  onExportPng,
  onEnrichSelected,
  onClearEnrichment
}: GraphToolbarProps): JSX.Element {
  const searchTerm = useKnowledgeGraphStore((s) => s.searchTerm)
  const setSearchTerm = useKnowledgeGraphStore((s) => s.setSearchTerm)
  const selectedIds = useKnowledgeGraphStore((s) => s.selectedIds)
  const enriching = useKnowledgeGraphStore((s) => s.enriching)
  const enrichProgress = useKnowledgeGraphStore((s) => s.enrichProgress)
  const graph = useKnowledgeGraphStore((s) => s.graph)
  const loadGraph = useKnowledgeGraphStore((s) => s.loadGraph)

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <Input
        allowClear
        prefix={<SearchOutlined className="text-gray-400" />}
        placeholder="搜索节点名称…"
        value={searchTerm}
        onChange={(e) => setSearchTerm(e.target.value)}
        style={{ width: 200 }}
        size="small"
      />

      <Tooltip title="重新布局">
        <Button size="small" icon={<ReloadOutlined />} onClick={onRelayout} />
      </Tooltip>

      <Tooltip title="导出 PNG">
        <Button size="small" icon={<CameraOutlined />} onClick={onExportPng} />
      </Tooltip>

      <div className="flex-1" />

      {graph && graph.entityCount > 0 && (
        <Tooltip title="清除所有 AI 抽取的实体/关系">
          <Button size="small" icon={<ClearOutlined />} onClick={onClearEnrichment} danger>
            清除AI层 ({graph.entityCount})
          </Button>
        </Tooltip>
      )}

      <Tooltip title={selectedIds.length === 0 ? '先 Ctrl+点击选中若干文档节点' : `对选中的 ${selectedIds.length} 个节点做实体/关系抽取`}>
        <Button
          size="small"
          type="primary"
          ghost
          icon={<ThunderboltOutlined />}
          disabled={selectedIds.length === 0 || enriching}
          loading={enriching}
          onClick={onEnrichSelected}
        >
          AI增强{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
        </Button>
      </Tooltip>

      {enriching && enrichProgress && (
        <div className="w-full flex items-center gap-2 mt-1">
          <Progress
            percent={enrichProgress.total > 0 ? Math.round((enrichProgress.done / enrichProgress.total) * 100) : 0}
            size="small"
            style={{ flex: 1, margin: 0 }}
          />
          <span className="text-xs text-gray-500 truncate" style={{ maxWidth: 200 }}>
            {enrichProgress.fileName}
          </span>
        </div>
      )}
    </div>
  )
}
