import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Empty, Input, Spin, Tag, message } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../Markdown/MarkdownRenderer'
import { usePanelCommandStore } from '../../stores/panelCommandStore'

interface SearchResult {
  content: string
  document_id: string
  file_name: string
  score: number
}

interface AskResult {
  answer: string
  sources: Array<{ file_name: string; snippet?: string }>
}

export default function KbPanel({ panelType, instanceId }: { panelType: string; instanceId: string }): JSX.Element {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [question, setQuestion] = useState('')
  const [askResult, setAskResult] = useState<AskResult | null>(null)
  const [asking, setAsking] = useState(false)
  const [docCount, setDocCount] = useState<number | null>(null)

  useEffect(() => {
    let alive = true
    window.aeromind.kb.stats().then((s: { totalDocuments: number }) => {
      if (alive) setDocCount(s.totalDocuments)
    }).catch(() => {})
    return () => {
      alive = false
    }
  }, [])

  const handleSearch = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearching(true)
    try {
      const res = (await window.aeromind.kb.search(q, 20)) as SearchResult[]
      setResults(res)
      if (res.length === 0) message.info('未找到相关内容')
    } catch {
      message.error('搜索失败')
    } finally {
      setSearching(false)
    }
  }, [query])

  const handleAsk = useCallback(async () => {
    const q = question.trim()
    if (!q) return
    setAsking(true)
    setAskResult(null)
    try {
      const res = (await window.aeromind.kb.ask(q)) as AskResult
      setAskResult(res)
    } catch {
      message.error('查询失败')
    } finally {
      setAsking(false)
    }
  }, [question])

  // 始终拿到最新 handleSearch/handleAsk，避免命令订阅 effect 的 stale closure
  const handleSearchRef = useRef(handleSearch)
  handleSearchRef.current = handleSearch
  const handleAskRef = useRef(handleAsk)
  handleAskRef.current = handleAsk

  // 对话→面板联动：订阅 panelCommandStore 里属于 kb 面板的命令
  // search action → 填 query 自动搜；ask action → 填 question 自动问
  useEffect(() => {
    if (panelType !== 'kb') return
    const handled = new Set<string>()
    const unsub = usePanelCommandStore.subscribe((state, prev) => {
      if (state.pending === prev.pending) return
      for (const cmd of state.pending) {
        if (cmd.panelType !== 'kb') continue
        if (cmd.instanceId && cmd.instanceId !== instanceId) continue
        if (handled.has(cmd.id)) continue
        handled.add(cmd.id)
        const q = typeof cmd.payload.query === 'string' ? String(cmd.payload.query) : ''
        if (!q) {
          usePanelCommandStore.getState().consume(cmd.id)
          continue
        }
        if (cmd.action === 'ask') {
          setQuestion(q)
          // 等 state 生效后调最新 handleAskRef
          queueMicrotask(() => handleAskRef.current())
        } else {
          // search / open / 默认 → 搜索
          setQuery(q)
          queueMicrotask(() => handleSearchRef.current())
        }
        usePanelCommandStore.getState().consume(cmd.id)
      }
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelType, instanceId])

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex items-center justify-between flex-shrink-0">
        <span className="text-xs text-gray-600">
          {docCount === null ? '知识库' : `知识库 · ${docCount} 篇文档`}
        </span>
      </div>

      <div className="p-3 border-b border-gray-200 flex-shrink-0">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onPressEnter={handleSearch}
            placeholder="搜索文档，回车检索..."
            prefix={<SearchOutlined />}
            size="small"
          />
          <Button size="small" onClick={handleSearch} loading={searching}>搜索</Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto">
        {results.length === 0 && !searching ? (
          <div className="h-full flex flex-col items-center justify-center gap-2 text-gray-400 p-4">
            <Empty image={<SearchOutlined style={{ fontSize: 40, color: '#d9d9d9' }} />} description="检索知识库文档" />
          </div>
        ) : searching ? (
          <div className="flex items-center justify-center py-16"><Spin size="small" /></div>
        ) : (
          <div className="space-y-2 p-3">
            {results.map((r, i) => (
              <div key={i} className="border border-gray-200 rounded p-2.5 shadow-sm">
                <div className="flex items-center gap-2 mb-1">
                  <Tag color="blue" className="text-xs">{r.file_name}</Tag>
                  <span className="text-[10px] text-gray-400">{r.score.toFixed(2)}</span>
                </div>
                <p className="text-xs text-gray-700 line-clamp-4 leading-relaxed">{r.content}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI 问答 */}
      <div className="border-t border-gray-200 flex-shrink-0">
        <div className="p-3 border-b border-gray-200">
          <div className="flex gap-2">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onPressEnter={handleAsk}
              placeholder="向知识库提问..."
              size="small"
            />
            <Button size="small" type="primary" onClick={handleAsk} loading={asking}>提问</Button>
          </div>
        </div>
        {askResult && (
          <div className="max-h-44 overflow-y-auto p-3">
            {askResult.sources.length > 0 && (
              <div className="mb-2 flex gap-1 flex-wrap">
                {askResult.sources.map((s, i) => (
                  <Tag key={i} color="blue" className="text-[10px]">{s.file_name}</Tag>
                ))}
              </div>
            )}
            <div className="text-xs text-gray-700 leading-relaxed">
              <MarkdownRenderer content={askResult.answer} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
