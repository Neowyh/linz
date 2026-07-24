import { useState, useEffect } from 'react'
import { Button, Tag, Input, Empty, message, Tabs, Popconfirm, Modal } from 'antd'
import { UploadOutlined, DeleteOutlined, SearchOutlined, FileTextOutlined, FileOutlined, DatabaseOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../components/Markdown/MarkdownRenderer'

interface KbDocument {
  id: string
  file_path: string
  file_name: string
  file_type: string
  domain_category: string
  index_status: string
  chunk_count: number
  file_size: number
  added_at: string
  indexed_at: string | null
}

interface KbStats {
  totalDocuments: number
  totalChunks: number
  categories: Array<{ category: string; count: number }>
}

interface SearchResult {
  content: string
  document_id: string
  file_name: string
  score: number
}

const FILE_TYPE_ICONS: Record<string, string> = {
  pdf: '📄', docx: '📝', doc: '📝', xlsx: '📊', csv: '📊',
  txt: '📃', md: '📃', dat: '✈️', json: '🔧',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️'
}

const CATEGORY_COLORS: Record<string, string> = {
  '气动分析': 'blue', '结构强度': 'orange', '推进设计': 'red',
  '航电控制': 'cyan', '总体设计': 'purple', '标准规范': 'geekblue', '未分类': 'default'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export default function KnowledgePage(): JSX.Element {
  const [documents, setDocuments] = useState<KbDocument[]>([])
  const [stats, setStats] = useState<KbStats | null>(null)
  const [categories, setCategories] = useState<string[]>(['全部'])
  const [activeCategory, setActiveCategory] = useState('全部')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [askQuestion, setAskQuestion] = useState('')
  const [askResult, setAskResult] = useState<{ answer: string; sources: any[] } | null>(null)
  const [asking, setAsking] = useState(false)

  const loadData = async (): Promise<void> => {
    try {
      const [docs, s, cats] = await Promise.all([
        activeCategory === '全部' ? window.aeromind.kb.listDocuments() : window.aeromind.kb.listByCategory(activeCategory),
        window.aeromind.kb.stats(),
        window.aeromind.kb.categories()
      ])
      setDocuments(docs)
      setStats(s)
      setCategories(cats)
    } catch {
      message.error('加载知识库数据失败')
    }
  }

  useEffect(() => { loadData() }, [activeCategory])

  const handleUpload = async (): Promise<void> => {
    setUploading(true)
    try {
      const result = await window.aeromind.kb.uploadDocuments()
      if (result.length === 0) {
        message.info('未选择文件')
      } else {
        message.success(`成功索引 ${result.length} 个文档`)
        loadData()
      }
    } catch (err: any) {
      message.error('上传失败: ' + (err.message || '未知错误'))
    } finally {
      setUploading(false)
    }
  }

  const handleSearch = async (): Promise<void> => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const results = await window.aeromind.kb.search(searchQuery, 10)
      setSearchResults(results)
      if (results.length === 0) {
        message.info('未找到相关内容')
      }
    } catch {
      message.error('搜索失败')
    } finally {
      setIsSearching(false)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    await window.aeromind.kb.deleteDocument(id)
    message.success('文档已删除')
    loadData()
  }

  const handleAsk = async (): Promise<void> => {
    if (!askQuestion.trim()) return
    setAsking(true)
    setAskResult(null)
    try {
      const result = await window.aeromind.kb.ask(askQuestion)
      setAskResult(result)
    } catch {
      message.error('查询失败')
    } finally {
      setAsking(false)
    }
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">本地知识库</h2>
            {stats && (
              <p className="text-xs text-gray-600 mt-1">
                已索引 {stats.totalDocuments} 个文档，{stats.totalChunks} 个文本块
              </p>
            )}
          </div>
          <Button type="primary" icon={<UploadOutlined />} loading={uploading} onClick={handleUpload}>
            添加文档
          </Button>
        </div>

        {/* 统计卡片 */}
        {stats && stats.categories.length > 0 && (
          <div className="flex gap-3 mb-6 flex-wrap">
            {stats.categories.map((cat) => (
              <button
                key={cat.category}
                onClick={() => setActiveCategory(cat.category)}
                className={`px-3 py-1.5 rounded-btn text-xs border transition-colors ${
                  activeCategory === cat.category
                    ? 'bg-primary text-white border-primary'
                    : 'bg-white text-gray-600 border-gray-200 hover:border-primary'
                }`}
              >
                {cat.category} ({cat.count})
              </button>
            ))}
            <button
              onClick={() => setActiveCategory('全部')}
              className={`px-3 py-1.5 rounded-btn text-xs border transition-colors ${
                activeCategory === '全部'
                  ? 'bg-primary text-white border-primary'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-primary'
              }`}
            >
              全部
            </button>
          </div>
        )}

        {/* 搜索栏 */}
        <div className="flex gap-2 mb-6">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={handleSearch}
            placeholder="搜索知识库..."
            prefix={<SearchOutlined />}
            size="large"
            className="flex-1"
          />
          <Button size="large" onClick={handleSearch} loading={isSearching}>搜索</Button>
        </div>

        {/* 搜索结果 */}
        {searchResults.length > 0 && (
          <div className="mb-8">
            <h3 className="text-sm font-medium text-gray-900 mb-3">搜索结果</h3>
            <div className="space-y-3">
              {searchResults.map((result, idx) => (
                <div key={idx} className="bg-white rounded-card border border-gray-100 p-4 shadow-sm">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag color="blue">{result.file_name}</Tag>
                    <span className="text-xs text-gray-300">相关度: {result.score}</span>
                  </div>
                  <p className="text-sm text-gray-900 line-clamp-4">{result.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 文档列表 */}
        <div className="mb-8">
          <h3 className="text-sm font-medium text-gray-900 mb-3">
            {activeCategory === '全部' ? '全部文档' : activeCategory}
          </h3>
          {documents.length === 0 ? (
            <Empty description='暂无文档，点击"添加文档"开始构建知识库' />
          ) : (
            <div className="space-y-2">
              {documents.map((doc) => (
                <div key={doc.id} className="bg-white rounded-card border border-gray-100 p-4 shadow-sm flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <span className="text-2xl flex-shrink-0">
                      {FILE_TYPE_ICONS[doc.file_type] || '📄'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium text-gray-900 truncate">{doc.file_name}</h4>
                      <div className="flex items-center gap-2 mt-1">
                        <Tag color={CATEGORY_COLORS[doc.domain_category] || 'default'} className="text-xs">
                          {doc.domain_category}
                        </Tag>
                        <span className="text-xs text-gray-300">
                          {doc.index_status === 'done' ? `已索引 ✅` : doc.index_status === 'indexing' ? '索引中 ⏳' : '错误 ❌'}
                        </span>
                        <span className="text-xs text-gray-300">{formatSize(doc.file_size)}</span>
                        {doc.chunk_count > 0 && (
                          <span className="text-xs text-gray-300">{doc.chunk_count}块</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <Popconfirm title="确定删除此文档？" onConfirm={() => handleDelete(doc.id)} okText="删除" cancelText="取消">
                      <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                    </Popconfirm>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 向知识库提问 */}
        <div className="bg-white rounded-card border border-gray-100 p-4 shadow-sm">
          <h3 className="text-sm font-medium text-gray-900 mb-3">💬 向知识库提问</h3>
          <div className="flex gap-2">
            <Input
              value={askQuestion}
              onChange={(e) => setAskQuestion(e.target.value)}
              onPressEnter={handleAsk}
              placeholder="这些文档中关于..."
              className="flex-1"
            />
            <Button type="primary" onClick={handleAsk} loading={asking}>提问</Button>
          </div>
          {askResult && (
            <div className="mt-4">
              {askResult.sources.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs text-gray-600 mb-1">参考来源：</p>
                  <div className="flex gap-1 flex-wrap">
                    {askResult.sources.map((s: any, i: number) => (
                      <Tag key={i} color="blue">{s.file_name}</Tag>
                    ))}
                  </div>
                </div>
              )}
              <div className="text-sm text-gray-700 prose prose-sm max-w-none">
                <MarkdownRenderer content={askResult.answer} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
