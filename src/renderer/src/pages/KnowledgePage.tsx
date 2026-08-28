import { useState, useEffect, useMemo } from 'react'
import { Button, Tag, Input, Empty, message, Progress, Popconfirm, Modal, Select, Checkbox, AutoComplete, Tabs, Pagination } from 'antd'
import { DeleteOutlined, SearchOutlined, TagsOutlined, EditOutlined, FolderOpenOutlined } from '@ant-design/icons'
import MarkdownRenderer from '../components/Markdown/MarkdownRenderer'
import KbTablesTab from '../components/KbTablesTab'
import KbGraphTab from '../components/graph/KbGraphTab'

interface KbDocument {
  id: string
  file_path: string
  file_name: string
  file_type: string
  domain_category: string
  tags: string[]
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
  dbSizeBytes?: number
}

interface KbImportProgress {
  total: number
  done: number
  current?: string
  fileName: string
  status: 'parsing' | 'indexing' | 'done' | 'skipped' | 'error'
  error?: string
  chunkCount?: number
}

interface KbImportSummary {
  total: number
  done: number
  skipped: number
  error: number
  results: Array<{ fileName: string; status: string; error?: string; chunkCount?: number; docId?: string }>
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

// 分类由用户手动指定，不再按内容自动解析
const DOMAIN_PRESETS = Object.keys(CATEGORY_COLORS)

const PROGRESS_STATUS_TEXT: Record<KbImportProgress['status'], string> = {
  parsing: '解析中', indexing: '写入索引', done: '完成', skipped: '已跳过', error: '失败'
}

const PROGRESS_STATUS_COLOR: Record<KbImportProgress['status'], string> = {
  parsing: 'text-blue-500', indexing: 'text-blue-500', done: 'text-green-600', skipped: 'text-gray-400', error: 'text-red-500'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)}GB`
}

export default function KnowledgePage(): JSX.Element {
  const [documents, setDocuments] = useState<KbDocument[]>([])
  const [stats, setStats] = useState<KbStats | null>(null)
  const [categories, setCategories] = useState<string[]>(['全部'])
  const [activeCategory, setActiveCategory] = useState('全部')
  const [allTags, setAllTags] = useState<string[]>([])
  const [activeTag, setActiveTag] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [askQuestion, setAskQuestion] = useState('')
  const [askResult, setAskResult] = useState<{ answer: string; sources: any[] } | null>(null)
  const [asking, setAsking] = useState(false)

  // 导入流程状态
  const [importModalOpen, setImportModalOpen] = useState(false)
  const [pendingPaths, setPendingPaths] = useState<string[]>([])
  const [importTags, setImportTags] = useState<string[]>([])
  const [importDomain, setImportDomain] = useState('未分类')
  const [importing, setImporting] = useState(false)
  const [importEvents, setImportEvents] = useState<KbImportProgress[]>([])
  const [importProgress, setImportProgress] = useState<{ total: number; done: number } | null>(null)

  // 标签编辑状态
  const [tagEditDoc, setTagEditDoc] = useState<KbDocument | null>(null)
  const [tagEditValue, setTagEditValue] = useState<string[]>([])
  const [tagEditDomain, setTagEditDomain] = useState('未分类')

  // 批量选择状态
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchDeleting, setBatchDeleting] = useState(false)

  const loadData = async (): Promise<void> => {
    try {
      const [docs, s, cats, tags] = await Promise.all([
        activeCategory === '全部' ? window.aeromind.kb.listDocuments() : window.aeromind.kb.listByCategory(activeCategory),
        window.aeromind.kb.stats(),
        window.aeromind.kb.categories(),
        window.aeromind.kb.tags()
      ])
      setDocuments(docs)
      setStats(s)
      setCategories(cats)
      setAllTags(tags)
    } catch {
      message.error('加载知识库数据失败')
    }
  }

  useEffect(() => {
    setSelectedIds([]) // 切换分类时清空选择，避免误删不可见文档
    setPage(1)
    loadData()
  }, [activeCategory])

  // 订阅导入进度事件
  useEffect(() => {
    const unsub = window.aeromind.kb.onImportProgress((event: KbImportProgress) => {
      setImportProgress({ total: event.total, done: event.done })
      setImportEvents((prev) => {
        // 同一文件保留最新状态
        const rest = prev.filter((e) => e.fileName !== event.fileName)
        return [...rest, event]
      })
    })
    return unsub
  }, [])

  // 第一步：选路径（文件/文件夹可多选）
  const handlePickImport = async (): Promise<void> => {
    const paths = await window.aeromind.kb.pickImportPaths()
    if (!paths || paths.length === 0) return
    setPendingPaths(paths)
    setImportTags([])
    setImportDomain('未分类')
    setImportModalOpen(true)
  }

  // 第二步：确认标签并开始导入
  const handleStartImport = async (): Promise<void> => {
    setImportModalOpen(false)
    setImporting(true)
    setImportEvents([])
    setImportProgress(null)
    try {
      const summary: KbImportSummary = await window.aeromind.kb.importPaths(pendingPaths, importTags, importDomain)
      const parts = [`完成 ${summary.done}`]
      if (summary.skipped > 0) parts.push(`重复跳过 ${summary.skipped}`)
      if (summary.error > 0) parts.push(`失败 ${summary.error}`)
      if (summary.error > 0) {
        message.warning(`导入结束：${parts.join('，')}`)
      } else {
        message.success(`导入完成：${parts.join('，')}`)
      }
      loadData()
    } catch (err: any) {
      message.error('导入失败: ' + (err.message || '未知错误'))
    } finally {
      setImporting(false)
    }
  }

  const handleSearch = async (): Promise<void> => {
    if (!searchQuery.trim()) return
    setIsSearching(true)
    try {
      const results = await window.aeromind.kb.search(searchQuery, 10, activeTag ? [activeTag] : undefined)
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
    setSelectedIds((prev) => prev.filter((sid) => sid !== id))
    loadData()
  }

  const toggleSelect = (id: string, checked: boolean): void => {
    setSelectedIds((prev) => (checked ? [...prev, id] : prev.filter((sid) => sid !== id)))
  }

  const toggleSelectAll = (checked: boolean): void => {
    setSelectedIds(checked ? filteredDocuments.map((d) => d.id) : [])
  }

  const handleBatchDelete = async (): Promise<void> => {
    if (selectedIds.length === 0) return
    setBatchDeleting(true)
    try {
      const result = await window.aeromind.kb.deleteDocuments(selectedIds)
      message.success(`已删除 ${result.deleted} 个文档`)
      setSelectedIds([])
      loadData()
    } catch (err: any) {
      message.error('批量删除失败: ' + (err.message || '未知错误'))
    } finally {
      setBatchDeleting(false)
    }
  }

  const handleAsk = async (): Promise<void> => {
    if (!askQuestion.trim()) return
    setAsking(true)
    setAskResult(null)
    try {
      const result = await window.aeromind.kb.ask(askQuestion, activeTag ? [activeTag] : undefined)
      setAskResult(result)
    } catch {
      message.error('查询失败')
    } finally {
      setAsking(false)
    }
  }

  const openTagEdit = (doc: KbDocument): void => {
    setTagEditDoc(doc)
    setTagEditValue(doc.tags || [])
    setTagEditDomain(doc.domain_category || '未分类')
  }

  const handleSaveTags = async (): Promise<void> => {
    if (!tagEditDoc) return
    await window.aeromind.kb.updateTags(tagEditDoc.id, tagEditValue)
    if ((tagEditDomain || '未分类') !== tagEditDoc.domain_category) {
      await window.aeromind.kb.updateDomain(tagEditDoc.id, tagEditDomain)
    }
    message.success('已更新')
    setTagEditDoc(null)
    loadData()
  }

  // 文档列表按当前标签过滤（useMemo 避免每次渲染全量 filter）
  const filteredDocuments = useMemo(
    () => (activeTag ? documents.filter((d) => (d.tags || []).includes(activeTag)) : documents),
    [documents, activeTag]
  )

  // 分页渲染，避免大知识库一次性渲染全部 DOM
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  const pageDocuments = useMemo(
    () => filteredDocuments.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredDocuments, page]
  )

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-5xl mx-auto">
        <Tabs
          defaultActiveKey="kb"
          items={[
            {
              key: 'kb',
              label: '知识库',
              children: (
                <>
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">本地知识库</h2>
            {stats && (
              <p className="text-xs text-gray-600 mt-1">
                已索引 {stats.totalDocuments} 个文档，{stats.totalChunks} 个文本块
                {typeof stats.dbSizeBytes === 'number' && stats.dbSizeBytes > 0 && `，库体积 ${formatSize(stats.dbSizeBytes)}`}
              </p>
            )}
          </div>
          <Button type="primary" icon={<FolderOpenOutlined />} loading={importing} onClick={handlePickImport}>
            导入文档/文件夹
          </Button>
        </div>

        {/* 导入进度 */}
        {(importing || importEvents.length > 0) && (
          <div className="bg-white rounded-card border border-line-light p-4 shadow-card mb-6">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm font-medium text-gray-900">
                {importing ? '正在导入…' : '上次导入结果'}
              </h3>
              {importProgress && (
                <span className="text-xs text-gray-500">{importProgress.done} / {importProgress.total}</span>
              )}
            </div>
            {importProgress && (
              <Progress
                percent={importProgress.total > 0 ? Math.round((importProgress.done / importProgress.total) * 100) : 0}
                size="small"
                status={importing ? 'active' : 'normal'}
              />
            )}
            <div className="mt-2 max-h-40 overflow-y-auto space-y-1">
              {importEvents.map((e) => (
                <div key={e.fileName} className="flex items-center gap-2 text-xs">
                  <span className={`flex-shrink-0 ${PROGRESS_STATUS_COLOR[e.status]}`}>
                    {PROGRESS_STATUS_TEXT[e.status]}
                  </span>
                  <span className="text-gray-700 truncate flex-1">{e.fileName}</span>
                  {typeof e.chunkCount === 'number' && <span className="text-gray-400">{e.chunkCount}块</span>}
                  {e.error && <span className="text-gray-400 truncate" title={e.error}>{e.error}</span>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 统计卡片 */}
        {stats && stats.categories.length > 0 && (
          <div className="flex gap-3 mb-4 flex-wrap">
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

        {/* 标签筛选 */}
        {allTags.length > 0 && (
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            <span className="text-xs text-gray-500 inline-flex items-center gap-1">
              <TagsOutlined /> 标签：
            </span>
            {allTags.map((tag) => (
              <Tag
                key={tag}
                color={activeTag === tag ? 'blue' : 'default'}
                className="cursor-pointer"
                onClick={() => {
                  setActiveTag(activeTag === tag ? null : tag)
                  setPage(1)
                }}
              >
                {tag}
              </Tag>
            ))}
            {activeTag && (
              <span className="text-xs text-gray-400">（搜索与提问将限定在「{activeTag}」标签内）</span>
            )}
          </div>
        )}

        {/* 搜索栏 */}
        <div className="flex gap-2 mb-6">
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onPressEnter={handleSearch}
            placeholder="搜索知识库（关键词至少2个字）..."
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
                <div key={idx} className="bg-white rounded-card border border-line-light p-4 shadow-card">
                  <div className="flex items-center gap-2 mb-2">
                    <Tag color="blue">{result.file_name}</Tag>
                    <span className="text-xs text-gray-300">相关度: {result.score.toFixed(2)}</span>
                  </div>
                  <p className="text-sm text-gray-900 line-clamp-4">{result.content}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 文档列表 */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-medium text-gray-900">
              {activeCategory === '全部' ? '全部文档' : activeCategory}
              {activeTag && <span className="ml-2 text-xs text-gray-500">（标签：{activeTag}）</span>}
            </h3>
            {filteredDocuments.length > 0 && (
              <div className="flex items-center gap-3">
                <Checkbox
                  checked={selectedIds.length === filteredDocuments.length && filteredDocuments.length > 0}
                  indeterminate={selectedIds.length > 0 && selectedIds.length < filteredDocuments.length}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                >
                  <span className="text-xs text-gray-600">全选</span>
                </Checkbox>
                {selectedIds.length > 0 && (
                  <Popconfirm
                    title={`确定删除选中的 ${selectedIds.length} 个文档？`}
                    description="文档及其索引将一并删除，不可恢复"
                    onConfirm={handleBatchDelete}
                    okText="删除"
                    cancelText="取消"
                    okButtonProps={{ danger: true }}
                  >
                    <Button size="small" danger icon={<DeleteOutlined />} loading={batchDeleting}>
                      删除选中（{selectedIds.length}）
                    </Button>
                  </Popconfirm>
                )}
              </div>
            )}
          </div>
          {filteredDocuments.length === 0 ? (
            <Empty description='暂无文档，点击"导入文档/文件夹"开始构建知识库' />
          ) : (
            <div className="space-y-2">
              {pageDocuments.map((doc) => (
                <div key={doc.id} className="bg-white rounded-card border border-line-light p-4 shadow-card flex items-center justify-between">
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    <Checkbox
                      checked={selectedIds.includes(doc.id)}
                      onChange={(e) => toggleSelect(doc.id, e.target.checked)}
                    />
                    <span className="text-2xl flex-shrink-0">
                      {FILE_TYPE_ICONS[doc.file_type] || '📄'}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h4 className="text-sm font-medium text-gray-900 truncate">{doc.file_name}</h4>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <Tag color={CATEGORY_COLORS[doc.domain_category] || 'default'} className="text-xs">
                          {doc.domain_category}
                        </Tag>
                        {(doc.tags || []).map((tag) => (
                          <Tag key={tag} color="green" className="text-xs">{tag}</Tag>
                        ))}
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
                    <Button type="text" size="small" icon={<EditOutlined />} onClick={() => openTagEdit(doc)} title="编辑分类与标签" />
                    <Popconfirm title="确定删除此文档？" onConfirm={() => handleDelete(doc.id)} okText="删除" cancelText="取消">
                      <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                    </Popconfirm>
                  </div>
                </div>
              ))}
            </div>
          )}
          {filteredDocuments.length > PAGE_SIZE && (
            <Pagination
              current={page}
              pageSize={PAGE_SIZE}
              total={filteredDocuments.length}
              onChange={setPage}
              showSizeChanger={false}
              className="mt-4 flex justify-center"
            />
          )}
        </div>

        {/* 向知识库提问 */}
        <div className="bg-white rounded-card border border-line-light p-4 shadow-card">
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
                </>
              )
            },
            { key: 'tables', label: '数据库', children: <KbTablesTab /> },
            { key: 'graph', label: '知识图谱', children: <KbGraphTab /> }
          ]}
        />
      </div>

      {/* 导入确认对话框：选路径后打标签 */}
      <Modal
        title="导入文档"
        open={importModalOpen}
        onOk={handleStartImport}
        onCancel={() => setImportModalOpen(false)}
        okText="开始导入"
        cancelText="取消"
      >
        <p className="text-sm text-gray-700 mb-2">已选择 {pendingPaths.length} 个路径（文件夹将递归扫描）：</p>
        <div className="max-h-32 overflow-y-auto mb-4 space-y-1">
          {pendingPaths.map((p) => (
            <div key={p} className="text-xs text-gray-500 truncate" title={p}>{p}</div>
          ))}
        </div>
        <p className="text-sm text-gray-700 mb-2">选择分类（默认未分类，可输入自定义分类）：</p>
        <AutoComplete
          style={{ width: '100%' }}
          className="mb-4"
          value={importDomain}
          onChange={setImportDomain}
          options={DOMAIN_PRESETS.map((d) => ({ value: d }))}
          placeholder="未分类"
        />
        <p className="text-sm text-gray-700 mb-2">为本批次文档添加标签（可选）：</p>
        <Select
          mode="tags"
          style={{ width: '100%' }}
          placeholder="输入标签后回车，如：安保、规范"
          value={importTags}
          onChange={setImportTags}
          options={allTags.map((t) => ({ label: t, value: t }))}
        />
        <p className="text-xs text-gray-400 mt-2">
          标签可用于知识库筛选检索，也可在 Agent 编辑页配置"知识库限定标签"，让指定 Agent 只检索该标签下的文档。
        </p>
      </Modal>

      {/* 文档分类与标签编辑对话框 */}
      <Modal
        title={`编辑分类与标签 - ${tagEditDoc?.file_name || ''}`}
        open={tagEditDoc !== null}
        onOk={handleSaveTags}
        onCancel={() => setTagEditDoc(null)}
        okText="保存"
        cancelText="取消"
      >
        <p className="text-sm text-gray-700 mb-2">分类：</p>
        <AutoComplete
          style={{ width: '100%' }}
          className="mb-4"
          value={tagEditDomain}
          onChange={setTagEditDomain}
          options={DOMAIN_PRESETS.map((d) => ({ value: d }))}
          placeholder="未分类"
        />
        <p className="text-sm text-gray-700 mb-2">标签：</p>
        <Select
          mode="tags"
          style={{ width: '100%' }}
          placeholder="输入标签后回车"
          value={tagEditValue}
          onChange={setTagEditValue}
          options={allTags.map((t) => ({ label: t, value: t }))}
        />
      </Modal>
    </div>
  )
}
