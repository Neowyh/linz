import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Input, Button, Tag, Empty, message } from 'antd'
import { SendOutlined, MessageOutlined, CloseOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../Markdown/MarkdownRenderer'
import { useKnowledgeGraphStore, selectedDocIds } from '../../stores/knowledgeGraphStore'
import { useUIStore } from '../../stores/uiStore'

interface AskResult {
  answer: string
  sources: Array<{ file_name: string; snippet: string }>
}

export default function GraphAskPanel(): JSX.Element {
  const navigate = useNavigate()
  const graph = useKnowledgeGraphStore((s) => s.graph)
  const selectedIds = useKnowledgeGraphStore((s) => s.selectedIds)
  const toggleSelected = useKnowledgeGraphStore((s) => s.toggleSelected)
  const clearSelection = useKnowledgeGraphStore((s) => s.clearSelection)
  const setPendingChatPrompt = useUIStore((s) => s.setPendingChatPrompt)

  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [result, setResult] = useState<AskResult | null>(null)

  const selectedNodes = graph?.nodes.filter((n) => selectedIds.includes(n.id)) || []
  const docIds = selectedDocIds(graph, selectedIds)

  const handleAsk = async (): Promise<void> => {
    if (!question.trim()) return
    if (docIds.length === 0) {
      message.info('请先 Ctrl+点击选中至少一个文档节点')
      return
    }
    setAsking(true)
    setResult(null)
    try {
      const r = await window.aeromind.kb.graphAsk(question.trim(), docIds)
      setResult(r)
    } catch (err) {
      message.error(`问答失败: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setAsking(false)
    }
  }

  const handleContinueInChat = (): void => {
    const docNames = selectedNodes
      .filter((n) => n.kind === 'document')
      .map((n) => n.label)
      .join('、')
    const prompt = `请基于以下知识库文档回答：${docNames || '所选文档'}。\n\n${question.trim()}`
    setPendingChatPrompt(prompt)
    navigate('/chat')
  }

  if (selectedIds.length === 0) {
    return (
      <div className="border-t border-line-light bg-gray-50 px-4 py-2 text-xs text-gray-500 flex items-center gap-2">
        <MessageOutlined />
        <span>Ctrl+点击图谱节点加入问答选择，即可基于选中文档提问或发起对话</span>
      </div>
    )
  }

  return (
    <div className="border-t border-line-light bg-white">
      {/* 已选节点 */}
      <div className="px-4 pt-2 flex items-center gap-1 flex-wrap">
        <span className="text-xs text-gray-500">已选 {selectedIds.length} 项：</span>
        {selectedNodes.map((n) => (
          <Tag
            key={n.id}
            closable
            closeIcon={<CloseOutlined />}
            onClose={() => toggleSelected(n.id)}
            className="!text-xs !mr-0"
            color={n.kind === 'entity' ? 'default' : 'blue'}
          >
            {n.kind === 'entity' ? `◇ ${n.label}` : n.label}
          </Tag>
        ))}
        <Button type="link" size="small" className="!text-xs !p-0" onClick={clearSelection}>
          清空
        </Button>
      </div>

      {/* 提问输入 */}
      <div className="px-4 py-2 flex items-center gap-2">
        <Input
          size="small"
          placeholder={`基于选中的 ${docIds.length} 个文档提问…`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onPressEnter={handleAsk}
        />
        <Button size="small" type="primary" icon={<SendOutlined />} loading={asking} onClick={handleAsk}>
          提问
        </Button>
        <Button size="small" icon={<MessageOutlined />} disabled={!question.trim()} onClick={handleContinueInChat}>
          在对话中继续
        </Button>
      </div>

      {/* 内嵌回答 */}
      {result && (
        <div className="px-4 pb-3 max-h-64 overflow-y-auto">
          <div className="bg-gray-50 rounded-lg p-3 border border-line-light">
            <MarkdownRenderer content={result.answer} />
            {result.sources.length > 0 && (
              <div className="mt-2 pt-2 border-t border-line-light">
                <div className="text-[10px] text-gray-400 mb-1">来源</div>
                <div className="flex flex-wrap gap-1">
                  {result.sources.map((s, i) => (
                    <Tag key={i} className="!text-[10px] !mr-0">{s.file_name}</Tag>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {!result && !asking && (
        <div className="px-4 pb-2">
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={<span className="text-xs text-gray-400">提问后在此显示基于选中文档的回答</span>} />
        </div>
      )}
    </div>
  )
}
