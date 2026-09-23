import { useEffect, useState, useCallback } from 'react'
import { Empty, Spin } from 'antd'
import WikiToolbar from './WikiToolbar'
import WikiGraphCanvas from './WikiGraphCanvas'
import WikiPageReader from './WikiPageReader'
import { useWikiStore } from '../../stores/wikiStore'
import type { WikiProgress } from '../../types/wiki'

export default function WikiTab(): JSX.Element {
  const {
    graph,
    currentPage,
    status,
    generating,
    generateProgress,
    graphMode,
    selectedSlug,
    loadingGraph,
    loadingPage,
    error,
    loadGraph,
    loadPage,
    loadStatus,
    loadPages,
    generate,
    deleteAll,
    setGraphMode,
    setSelectedSlug,
    setGenerateProgress
  } = useWikiStore()

  const [searchTerm, setSearchTerm] = useState('')

  // 初始化：加载状态 + 图谱
  useEffect(() => {
    loadStatus().then(() => {
      loadGraph()
      loadPages()
    })
  }, [loadStatus, loadGraph, loadPages])

  // 订阅生成进度
  useEffect(() => {
    const unsub = window.aeromind.kb.onWikiProgress((p: WikiProgress) => {
      setGenerateProgress(p)
    })
    return unsub
  }, [setGenerateProgress])

  // 模式切换时重新加载图谱
  const handleModeChange = useCallback((mode: 'overview' | 'ego') => {
    setGraphMode(mode)
    if (mode === 'overview') {
      loadGraph({ mode: 'overview' })
    }
  }, [setGraphMode, loadGraph])

  // 节点点击：加载页面 + ego 模式下切换中心
  const handleNodeClick = useCallback((slug: string) => {
    setSelectedSlug(slug)
    loadPage(slug)
    if (graphMode === 'ego') {
      loadGraph({ mode: 'ego', center: slug, depth: 2 })
    }
  }, [setSelectedSlug, loadPage, graphMode, loadGraph])

  // Wiki 链接点击：跳转到目标页面
  const handleWikiLinkClick = useCallback((slug: string) => {
    handleNodeClick(slug)
  }, [handleNodeClick])

  // 生成
  const handleGenerate = useCallback(() => {
    generate()
  }, [generate])

  // 删除
  const handleDeleteAll = useCallback(() => {
    deleteAll()
  }, [deleteAll])

  // 无 Wiki 且非生成中：空状态
  if (!status?.hasWiki && !generating && !loadingGraph) {
    return (
      <div className="h-full flex flex-col">
        <WikiToolbar
          hasWiki={false}
          generating={generating}
          generateProgress={generateProgress}
          graphMode={graphMode}
          searchTerm={searchTerm}
          onGenerate={handleGenerate}
          onDeleteAll={handleDeleteAll}
          onModeChange={handleModeChange}
          onSearchChange={setSearchTerm}
        />
        <div className="flex-1 flex items-center justify-center">
          <Empty description="尚未生成 Wiki 知识图谱。请先在「知识图谱」标签页中执行 AI 实体/关系增强，然后点击「生成 Wiki」">
            {!status?.hasWiki && <span className="text-xs text-gray-400 mt-2 block">Wiki 基于知识图谱中的实体和关系自动生成互链知识页面</span>}
          </Empty>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <WikiToolbar
        hasWiki={status?.hasWiki ?? false}
        generating={generating}
        generateProgress={generateProgress}
        graphMode={graphMode}
        searchTerm={searchTerm}
        onGenerate={handleGenerate}
        onDeleteAll={handleDeleteAll}
        onModeChange={handleModeChange}
        onSearchChange={setSearchTerm}
      />

      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-xs">{error}</div>
      )}

      <div className="flex-1 flex min-h-0">
        {/* 左侧：图谱 */}
        <div className="flex-1 min-w-0 border-r border-gray-100 relative">
          {loadingGraph && !graph ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <Spin tip="加载图谱..." />
            </div>
          ) : graph && graph.nodes.length > 0 ? (
            <WikiGraphCanvas
              data={graph}
              selectedSlug={selectedSlug}
              onNodeClick={handleNodeClick}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center">
              <Empty description="暂无图谱数据" />
            </div>
          )}
        </div>

        {/* 右侧：页面阅读器 */}
        <div className="w-1/2 min-w-[300px] max-w-[600px]">
          <WikiPageReader
            page={currentPage}
            loading={loadingPage}
            onLinkClick={handleWikiLinkClick}
          />
        </div>
      </div>
    </div>
  )
}
