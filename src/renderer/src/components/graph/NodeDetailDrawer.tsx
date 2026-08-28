import { useEffect, useState } from 'react'
import { Drawer, Tag, Button, Empty, Spin, message } from 'antd'
import { FileTextOutlined, ThunderboltOutlined, PlusOutlined } from '@ant-design/icons'
import { useKnowledgeGraphStore } from '../../stores/knowledgeGraphStore'
import type { GraphNode, GraphChunk } from '../../types/knowledgeGraph'

const CATEGORY_TAG_COLORS: Record<string, string> = {
  '气动分析': 'blue', '结构强度': 'orange', '推进设计': 'red',
  '航电控制': 'cyan', '总体设计': 'purple', '标准规范': 'geekblue', '未分类': 'default'
}

interface NodeDetailDrawerProps {
  onEnrichDoc: (docId: string) => void
}

export default function NodeDetailDrawer({ onEnrichDoc }: NodeDetailDrawerProps): JSX.Element {
  const graph = useKnowledgeGraphStore((s) => s.graph)
  const detailNodeId = useKnowledgeGraphStore((s) => s.detailNodeId)
  const setDetailNodeId = useKnowledgeGraphStore((s) => s.setDetailNodeId)
  const toggleSelected = useKnowledgeGraphStore((s) => s.toggleSelected)
  const selectedIds = useKnowledgeGraphStore((s) => s.selectedIds)
  const enriching = useKnowledgeGraphStore((s) => s.enriching)

  const [chunks, setChunks] = useState<GraphChunk[]>([])
  const [loadingChunks, setLoadingChunks] = useState(false)

  const node: GraphNode | null = graph?.nodes.find((n) => n.id === detailNodeId) || null
  const docId = node?.kind === 'document' ? node.id.replace(/^doc:/, '') : null

  // 打开文档节点时加载原文片段
  useEffect(() => {
    if (!node || node.kind !== 'document' || !docId) {
      setChunks([])
      return
    }
    let cancelled = false
    setLoadingChunks(true)
    window.aeromind.kb.graphDocChunks(docId, 20)
      .then((result) => {
        if (!cancelled) setChunks(result)
      })
      .catch(() => {
        if (!cancelled) setChunks([])
      })
      .finally(() => {
        if (!cancelled) setLoadingChunks(false)
      })
    return () => { cancelled = true }
  }, [node, docId])

  // 实体节点：找来源文档节点
  const sourceDocNodes: GraphNode[] =
    node?.kind === 'entity' && node.docIds
      ? graph?.nodes.filter((n) => n.kind === 'document' && node.docIds!.includes(n.id.replace(/^doc:/, ''))) || []
      : []

  return (
    <Drawer
      open={!!node}
      onClose={() => setDetailNodeId(null)}
      width={420}
      mask={false}
      title={
        node ? (
          <div className="flex items-center gap-2">
            {node.kind === 'document' ? <FileTextOutlined /> : '◇'}
            <span className="truncate">{node.label}</span>
          </div>
        ) : null
      }
    >
      {!node ? null : node.kind === 'document' ? (
        <div>
          {/* 文档元信息 */}
          <div className="mb-3">
            <Tag color={CATEGORY_TAG_COLORS[node.category || '未分类'] || 'default'}>{node.category || '未分类'}</Tag>
            {(node.tags || []).map((t) => (
              <Tag key={t} className="!text-xs">{t}</Tag>
            ))}
            <div className="text-xs text-gray-500 mt-2">{node.chunkCount || 0} 个文本块</div>
          </div>

          {/* 操作 */}
          <div className="flex gap-2 mb-4">
            <Button
              size="small"
              icon={<PlusOutlined />}
              type={selectedIds.includes(node.id) ? 'primary' : 'default'}
              onClick={() => toggleSelected(node.id)}
            >
              {selectedIds.includes(node.id) ? '已加入问答' : '加入问答选择'}
            </Button>
            <Button
              size="small"
              icon={<ThunderboltOutlined />}
              disabled={enriching}
              onClick={() => {
                if (docId) onEnrichDoc(docId)
                else message.info('无法识别文档')
              }}
            >
              AI增强此文档
            </Button>
          </div>

          {/* 原文片段 */}
          <div className="text-xs font-medium text-gray-700 mb-2">原文片段</div>
          {loadingChunks ? (
            <div className="flex justify-center py-8"><Spin size="small" /></div>
          ) : chunks.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无内容" />
          ) : (
            <div className="space-y-2">
              {chunks.map((c) => (
                <div key={c.chunk_index} className="bg-gray-50 rounded-lg p-3 border border-line-light">
                  <div className="text-[10px] text-gray-400 mb-1">片段 #{c.chunk_index + 1}</div>
                  <div className="text-xs text-gray-700 leading-relaxed line-clamp-4">{c.content}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          {/* 实体节点 */}
          <div className="mb-3">
            <Tag color="default">{node.entityType || '概念'}</Tag>
            <span className="text-xs text-gray-500 ml-2">出现于 {node.docIds?.length || 0} 个文档</span>
          </div>
          <div className="text-xs font-medium text-gray-700 mb-2">来源文档</div>
          <div className="space-y-2">
            {sourceDocNodes.map((d) => (
              <div
                key={d.id}
                className="bg-gray-50 rounded-lg p-3 border border-line-light cursor-pointer hover:border-primary transition-colors"
                onClick={() => setDetailNodeId(d.id)}
              >
                <div className="text-xs text-gray-800 flex items-center gap-1">
                  <FileTextOutlined className="text-gray-400" />
                  {d.label}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </Drawer>
  )
}
