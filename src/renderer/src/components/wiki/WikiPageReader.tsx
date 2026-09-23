import { useMemo, useCallback } from 'react'
import { Tag, Empty, Spin } from 'antd'
import MarkdownRenderer from '../Markdown/MarkdownRenderer'
import type { WikiPage } from '../../types/wiki'

interface WikiPageReaderProps {
  page: WikiPage | null
  loading: boolean
  onLinkClick: (slug: string) => void
}

// 将 [[slug|name]] 或 [[slug]] 替换为 markdown 哈希链接 [name](#wiki-slug)
// react-markdown 的 defaultUrlTransform 允许 # 开头的相对 URL，不会被安全过滤拦截
// 点击事件由容器层委托捕获 a[href^="#wiki-"] 的点击
const WIKILINK_PREFIX = 'wiki-'

function preprocessWikiLinks(content: string): string {
  return content.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, slug, name) => {
    const display = name || slug
    return `[${display}](#${WIKILINK_PREFIX}${slug.trim()})`
  })
}

export default function WikiPageReader({ page, loading, onLinkClick }: WikiPageReaderProps): JSX.Element {
  const processedContent = useMemo(() => {
    if (!page?.content) return ''
    return preprocessWikiLinks(page.content)
  }, [page?.content])

  // 事件委托：捕获容器内 a[href^="#wiki-"] 的点击
  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const anchor = target.closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href') || ''
    if (!href.startsWith(`#${WIKILINK_PREFIX}`)) return
    e.preventDefault()
    const slug = href.slice(1 + WIKILINK_PREFIX.length)
    if (slug) onLinkClick(slug)
  }, [onLinkClick])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Spin tip="加载中..." />
      </div>
    )
  }

  if (!page) {
    return (
      <div className="flex items-center justify-center h-full">
        <Empty description="点击图谱节点查看页面内容" />
      </div>
    )
  }

  const pageTypeColors: Record<string, string> = {
    entity: 'blue', concept: 'purple', summary: 'cyan',
    index: 'orange', synthesis: 'red', comparison: 'green'
  }

  return (
    <div className="h-full overflow-y-auto p-4 bg-white" onClick={handleClick}>
      {/* 页面头部 */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-1">
          <Tag color={pageTypeColors[page.pageType] || 'default'}>{page.pageType}</Tag>
          <h2 className="text-lg font-semibold text-gray-900 m-0">{page.title}</h2>
        </div>
        {page.summary && (
          <p className="text-sm text-gray-500 italic">{page.summary}</p>
        )}
        {page.inLinks.length > 0 && (
          <p className="text-xs text-gray-400 mt-1">被 {page.inLinks.length} 个页面引用</p>
        )}
      </div>

      {/* 正文 */}
      <div className="text-sm text-gray-700 prose prose-sm max-w-none">
        <MarkdownRenderer content={processedContent} />
      </div>

      {/* 来源引用 */}
      {page.sourceRefs.length > 0 && (
        <div className="mt-6 pt-4 border-t border-gray-100">
          <p className="text-xs text-gray-400 mb-1">来源文档：</p>
          <div className="flex gap-1 flex-wrap">
            {page.sourceRefs.map((_ref, i) => (
              <Tag key={i} className="text-xs">文档 {i + 1}</Tag>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
