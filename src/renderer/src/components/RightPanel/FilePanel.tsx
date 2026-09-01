import { useCallback, useEffect, useRef, useState } from 'react'
import {
  CaretDownOutlined,
  CaretRightOutlined,
  FileOutlined,
  FolderOpenOutlined,
  FolderOutlined,
  ReloadOutlined,
  ExportOutlined,
  FileSearchOutlined,
  FileTextOutlined
} from '@ant-design/icons'
import { Button, Empty, message, Spin, Tooltip } from 'antd'
import DOMPurify from 'dompurify'
import MarkdownRenderer from '../Markdown/MarkdownRenderer'
import { usePanelCommandStore } from '../../stores/panelCommandStore'

interface FileEntry {
  name: string
  relPath: string
  type: 'dir' | 'file'
  size: number
  mtime: number
}

type FilePreviewData =
  | { kind: 'text'; content: string; language?: string; truncated?: boolean }
  | { kind: 'html'; html: string; truncated?: boolean }
  | { kind: 'pdf'; url: string; text: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'binary'; message: string }
  | { error: string }

interface WebviewElement extends HTMLElement {
  src: string
  reload(): void
  addEventListener(type: string, listener: (e: any) => void): void
  removeEventListener(type: string, listener: (e: any) => void): void
}

// Word/Excel 生成的 HTML 预览的基础样式
const PREVIEW_HTML_CSS = `
.linz-html-preview { font-size: 13px; line-height: 1.7; color: #1f2329; word-break: break-word; }
.linz-html-preview h1 { font-size: 20px; font-weight: 700; margin: 12px 0 8px; }
.linz-html-preview h2 { font-size: 17px; font-weight: 700; margin: 10px 0 6px; }
.linz-html-preview h3 { font-size: 15px; font-weight: 600; margin: 8px 0 4px; }
.linz-html-preview p { margin: 6px 0; }
.linz-html-preview img { max-width: 100%; }
.linz-html-preview table { border-collapse: collapse; margin: 8px 0; }
.linz-html-preview td, .linz-html-preview th { border: 1px solid #d0d7de; padding: 4px 8px; font-size: 12px; }
.linz-html-preview pre { background: #f6f8fa; padding: 8px; border-radius: 6px; overflow-x: auto; }
.linz-html-preview ul, .linz-html-preview ol { padding-left: 20px; }
.linz-html-preview a { color: #1e6fcc; }
.linz-xlsx-sheet { margin-bottom: 12px; }
.linz-xlsx-title { font-weight: 600; font-size: 13px; margin-bottom: 4px; color: #1e6fcc; }
.linz-xlsx-sheet table { border-collapse: collapse; }
.linz-xlsx-sheet td, .linz-xlsx-sheet th { border: 1px solid #d0d7de; padding: 4px 8px; font-size: 12px; white-space: nowrap; }
`

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

function basename(p: string): string {
  const parts = p.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : p
}

interface TreeRowProps {
  entry: FileEntry
  depth: number
  childrenMap: Record<string, FileEntry[] | undefined>
  expanded: Set<string>
  selectedRel: string | null
  onToggle: (entry: FileEntry) => void
  onSelect: (entry: FileEntry) => void
}

function TreeRow({
  entry,
  depth,
  childrenMap,
  expanded,
  selectedRel,
  onToggle,
  onSelect
}: TreeRowProps): JSX.Element {
  const isDir = entry.type === 'dir'
  const isExpanded = isDir && expanded.has(entry.relPath)
  const isSelected = !isDir && selectedRel === entry.relPath
  const children = isDir ? childrenMap[entry.relPath] : undefined
  const loading = isDir && isExpanded && children === undefined

  return (
    <>
      <div
        className={`flex items-center gap-1 pr-1 py-[3px] rounded text-xs cursor-pointer select-none group ${
          isSelected ? 'bg-primary/10 text-primary' : 'text-gray-700 hover:bg-gray-100'
        }`}
        style={{ paddingLeft: depth * 14 + 6 }}
        onClick={() => (isDir ? onToggle(entry) : onSelect(entry))}
        title={entry.relPath || entry.name}
      >
        {isDir ? (
          isExpanded ? (
            <CaretDownOutlined className="text-[10px] text-gray-400 shrink-0" />
          ) : (
            <CaretRightOutlined className="text-[10px] text-gray-400 shrink-0" />
          )
        ) : (
          <span className="inline-block w-[10px] shrink-0" />
        )}
        {isDir ? (
          <FolderOutlined className={isExpanded ? 'text-[#f5b94c] shrink-0' : 'text-[#e8a33d] shrink-0'} />
        ) : (
          <FileOutlined className="text-gray-400 shrink-0" />
        )}
        <span className="truncate">{entry.name}</span>
        {loading && <Spin size="small" className="ml-auto" />}
        {!isDir && (
          <span className="ml-auto text-[10px] text-gray-400 opacity-0 group-hover:opacity-100 shrink-0">
            {entry.size > 0 ? formatBytes(entry.size) : ''}
          </span>
        )}
      </div>
      {isDir && isExpanded && (
        <div>
          {children === undefined ? (
            <div className="flex items-center gap-1 text-[11px] text-gray-400" style={{ paddingLeft: (depth + 1) * 14 + 6 }}>
              <Spin size="small" /> 加载中...
            </div>
          ) : children.length === 0 ? (
            <div className="text-[11px] text-gray-400 italic" style={{ paddingLeft: (depth + 1) * 14 + 6 }}>
              空目录
            </div>
          ) : (
            children.map((child) => (
              <TreeRow
                key={child.relPath || child.name}
                entry={child}
                depth={depth + 1}
                childrenMap={childrenMap}
                expanded={expanded}
                selectedRel={selectedRel}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ))
          )}
        </div>
      )}
    </>
  )
}

interface PdfPreviewProps {
  url: string
  text: string
  onOpenExternal: () => void
}

// PDF 预览：优先用内置 Chromium PDF 查看器（webview 加载 file:// ），失败/文本视图兜底
function PdfPreview({ url, text, onOpenExternal }: PdfPreviewProps): JSX.Element {
  const [view, setView] = useState<'page' | 'text'>('page')
  const [failed, setFailed] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const wvRef = useRef<WebviewElement | null>(null)

  useEffect(() => {
    setFailed(false)
    setView('page')
  }, [url])

  useEffect(() => {
    const wv = wvRef.current
    if (!wv || view !== 'page') return
    const onFail = (e: any): void => {
      // -3 = ERR_ABORTED，可能是被中断而非真失败
      if (e?.errorCode === -3) return
      setFailed(true)
    }
    wv.addEventListener('did-fail-load', onFail)
    return () => wv.removeEventListener('did-fail-load', onFail)
  }, [view, reloadKey])

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 bg-white flex-shrink-0">
        <Button size="small" type={view === 'page' ? 'primary' : 'text'} onClick={() => setView('page')}>
          页面
        </Button>
        <Button size="small" type={view === 'text' ? 'primary' : 'text'} onClick={() => setView('text')}>
          文本
        </Button>
        <div className="flex-1" />
        <Tooltip title="在系统中打开">
          <Button size="small" type="text" icon={<ExportOutlined />} onClick={onOpenExternal} />
        </Tooltip>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden bg-[#e8eaed]">
        {view === 'page' && !failed && (
          <webview
            key={reloadKey}
            ref={(el) => {
              wvRef.current = (el as WebviewElement | null)
            }}
            src={url}
            className="w-full h-full"
          />
        )}
        {view === 'page' && failed && (
          <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400 px-4 bg-white">
            <span className="text-sm">⚠️</span>
            <span className="text-xs text-center">无法在应用内渲染 PDF（可能受系统环境限制），可改用文本预览或在系统中打开</span>
            <div className="flex gap-2">
              <Button
                size="small"
                type="primary"
                ghost
                onClick={() => {
                  setFailed(false)
                  setReloadKey((k) => k + 1)
                }}
              >
                重试渲染
              </Button>
              <Button size="small" onClick={() => setView('text')}>
                文本预览
              </Button>
              <Button size="small" icon={<ExportOutlined />} onClick={onOpenExternal}>
                在系统中打开
              </Button>
            </div>
          </div>
        )}
        {view === 'text' && (
          <div className="h-full overflow-auto p-3 bg-white">
            {text ? (
              <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">{text}</pre>
            ) : (
              <div className="text-gray-400 text-xs">（未提取到文本内容）</div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function FilePanel({
  instanceId,
  panelType
}: {
  instanceId: string
  panelType: string
}): JSX.Element {
  const [root, setRoot] = useState<string | null>(null)
  const [rootLoading, setRootLoading] = useState(true)
  const [treeError, setTreeError] = useState<string | null>(null)

  const [childrenMap, setChildrenMap] = useState<Record<string, FileEntry[] | undefined>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']))
  const [selected, setSelected] = useState<FileEntry | null>(null)
  const [preview, setPreview] = useState<FilePreviewData | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)

  const loadChildren = useCallback(
    async (relPath: string): Promise<void> => {
      setTreeError(null)
      const res = await window.aeromind.files.list(relPath)
      if ('error' in res) {
        setChildrenMap((prev) => ({ ...prev, [relPath]: [] }))
        setTreeError(res.error)
        return
      }
      setChildrenMap((prev) => ({ ...prev, [relPath]: res.entries }))
    },
    []
  )

  const loadRoot = useCallback(async (): Promise<void> => {
    setRootLoading(true)
    setTreeError(null)
    setChildrenMap({})
    setExpanded(new Set(['']))
    setSelected(null)
    setPreview(null)
    try {
      const { root } = await window.aeromind.files.getRoot()
      setRoot(root)
      if (root) {
        await loadChildren('')
      }
    } catch (err) {
      setRoot(null)
      setTreeError((err as Error).message || String(err))
    } finally {
      setRootLoading(false)
    }
  }, [loadChildren])

  useEffect(() => {
    void loadRoot()
  }, [loadRoot])

  const toggleDir = useCallback(
    (entry: FileEntry): void => {
      setExpanded((prev) => {
        const next = new Set(prev)
        if (next.has(entry.relPath)) {
          next.delete(entry.relPath)
        } else {
          next.add(entry.relPath)
          if (childrenMap[entry.relPath] === undefined) {
            void loadChildren(entry.relPath)
          }
        }
        return next
      })
    },
    [childrenMap, loadChildren]
  )

  const selectFile = useCallback(async (entry: FileEntry): Promise<void> => {
    setSelected(entry)
    setPreview(null)
    setPreviewLoading(true)
    try {
      const data = await window.aeromind.files.read(entry.relPath)
      setPreview(data)
    } catch (err) {
      setPreview({ error: (err as Error).message || String(err) })
    } finally {
      setPreviewLoading(false)
    }
  }, [])

  // 对话→面板联动：按命令 payload.path 定位到文件并预览（绕过目录树选择）。
  // 用 ref 持有最新实现，订阅 effect 不必依赖它。
  const openByPathRef = useRef<(path: string) => Promise<void>>(async () => {})
  openByPathRef.current = async (path): Promise<void> => {
    if (!path) return
    // 构造最小 FileEntry（basename + relPath），复用 selectFile 的预览逻辑
    const entry: FileEntry = { name: basename(path), relPath: path, type: 'file', size: 0, mtime: 0 }
    await selectFile(entry)
  }

  // 对话→面板联动：订阅 panelCommandStore 里属于 files 面板的命令，
  // 收到 open/locate/reveal action 时按 payload.path 选中文件并预览。
  useEffect(() => {
    if (panelType !== 'files') return
    const handled = new Set<string>()
    const unsub = usePanelCommandStore.subscribe((state, prev) => {
      if (state.pending === prev.pending) return
      for (const cmd of state.pending) {
        if (cmd.panelType !== 'files') continue
        if (cmd.instanceId && cmd.instanceId !== instanceId) continue
        if (cmd.action !== 'open' && cmd.action !== 'locate' && cmd.action !== 'reveal' && cmd.action !== 'load') continue
        if (handled.has(cmd.id)) continue
        handled.add(cmd.id)
        const path = typeof cmd.payload.path === 'string' ? cmd.payload.path.trim() : ''
        void openByPathRef.current(path).finally(() => {
          usePanelCommandStore.getState().consume(cmd.id)
        })
      }
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelType, instanceId])

  const handlePickFolder = useCallback(async (): Promise<void> => {
    const picked = await window.aeromind.fileWorkspace.pickFolder()
    if (!picked) return
    const r = await window.aeromind.workspace.setFolder(picked)
    if (r.success) {
      message.success(`已设置工作空间: ${picked}`)
      void loadRoot()
    } else {
      message.error(r.error || '设置工作空间失败')
    }
  }, [loadRoot])

  const handleRefresh = useCallback(async (): Promise<void> => {
    if (!root) return
    await loadRoot()
  }, [root, loadRoot])

  const handleOpenExternal = useCallback(async (relPath: string): Promise<void> => {
    const r = await window.aeromind.files.openExternal(relPath)
    if (!r.success) message.error(r.error || '打开失败')
  }, [])

  const handleReveal = useCallback(async (relPath: string): Promise<void> => {
    const r = await window.aeromind.files.reveal(relPath)
    if (!r.success) message.error(r.error || '定位失败')
  }, [])

  // ---- 预览渲染 ----
  const renderPreviewContent = (): JSX.Element => {
    if (!selected) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400 px-4">
          <FolderOpenOutlined className="text-3xl" />
          <span className="text-xs">从左侧选择文件以预览</span>
        </div>
      )
    }
    if (previewLoading) {
      return (
        <div className="h-full flex items-center justify-center">
          <Spin size="small" />
        </div>
      )
    }
    if (!preview) return <></>

    // 错误分支（无 kind 判别字段）
    if (!('kind' in preview)) {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400 px-4">
          <span className="text-xs">{preview.error}</span>
        </div>
      )
    }

    if (preview.kind === 'pdf') {
      return (
        <PdfPreview
          key={selected.relPath}
          url={preview.url}
          text={preview.text}
          onOpenExternal={() => void handleOpenExternal(selected.relPath)}
        />
      )
    }

    if (preview.kind === 'html') {
      return (
        <>
          <style>{PREVIEW_HTML_CSS}</style>
          <div className="h-full overflow-auto bg-white">
            <div className="linz-html-preview p-3" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(preview.html) }} />
          </div>
        </>
      )
    }

    if (preview.kind === 'image') {
      return (
        <div className="h-full overflow-auto bg-[#f7f8fa] flex items-center justify-center p-2">
          <img src={preview.dataUrl} alt={selected.name} className="max-w-full max-h-full object-contain rounded shadow-sm" />
        </div>
      )
    }

    if (preview.kind === 'binary') {
      return (
        <div className="h-full flex flex-col items-center justify-center gap-3 text-gray-400 px-4">
          <span className="text-sm">⚠️</span>
          <span className="text-xs text-center">{preview.message}</span>
          <Button size="small" type="primary" ghost icon={<ExportOutlined />} onClick={() => handleOpenExternal(selected.relPath)}>
            在系统中打开
          </Button>
        </div>
      )
    }

    // text
    const isMarkdown = /\.(md|markdown)$/i.test(selected.name)
    if (isMarkdown) {
      return (
        <div className="h-full overflow-auto px-3 py-2">
          <MarkdownRenderer content={preview.content} />
        </div>
      )
    }
    if (preview.language && !preview.content.includes('```')) {
      return (
        <div className="h-full overflow-auto">
          <MarkdownRenderer content={`\`\`\`${preview.language}\n${preview.content}\n\`\`\``} />
        </div>
      )
    }
    return (
      <div className="h-full overflow-auto p-3">
        <pre className="text-xs leading-relaxed whitespace-pre-wrap break-words font-mono">{preview.content}</pre>
      </div>
    )
  }

  // ---- 空状态：未设置工作空间 ----
  if (!rootLoading && !root) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-6 bg-white">
        <Empty description="尚未设置工作空间目录" />
        <Button type="primary" icon={<FolderOpenOutlined />} onClick={() => void handlePickFolder()}>
          选择文件夹
        </Button>
        <span className="text-[11px] text-gray-400 text-center max-w-[240px]">
          选择一个文件夹后，可在此浏览文件并预览，Agent 也可读写该目录内文件
        </span>
      </div>
    )
  }

  const rootName = root ? basename(root) : ''

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 顶部工具条 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-gray-800 truncate" title={root || ''}>
            {rootName || '工作空间'}
          </div>
          {root && (
            <div className="text-[10px] text-gray-400 truncate" title={root}>
              {root}
            </div>
          )}
        </div>
        <Tooltip title="选择/切换文件夹">
          <Button size="small" type="text" icon={<FolderOpenOutlined />} onClick={() => void handlePickFolder()} />
        </Tooltip>
        <Tooltip title="刷新">
          <Button size="small" type="text" icon={<ReloadOutlined />} onClick={() => void handleRefresh()} />
        </Tooltip>
        <Tooltip title="在资源管理器中打开">
          <Button size="small" type="text" icon={<ExportOutlined />} onClick={() => void handleOpenExternal('')} />
        </Tooltip>
      </div>

      {/* 双栏：目录树 + 预览 */}
      <div className="flex-1 flex min-h-0">
        {/* 目录树 */}
        <div className="w-[180px] flex-shrink-0 border-r border-gray-200 overflow-y-auto overflow-x-hidden bg-white">
          {rootLoading ? (
            <div className="flex items-center justify-center py-6">
              <Spin size="small" />
            </div>
          ) : (
            <div className="py-1">
              {treeError && (
                <div className="px-2 py-1 text-[11px] text-red-500">{treeError}</div>
              )}
              {root && (
                <TreeRow
                  entry={{ name: rootName, relPath: '', type: 'dir', size: 0, mtime: 0 }}
                  depth={0}
                  childrenMap={childrenMap}
                  expanded={expanded}
                  selectedRel={selected?.relPath ?? null}
                  onToggle={toggleDir}
                  onSelect={selectFile}
                />
              )}
            </div>
          )}
        </div>
        {/* 预览区 */}
        <div className="flex-1 min-w-0 flex flex-col">
          {selected && (
            <div className="flex items-center gap-1 px-2 py-1 border-b border-gray-200 bg-white flex-shrink-0">
              <span className="text-xs text-gray-700 font-medium truncate flex-1">{selected.name}</span>
              <span className="text-[10px] text-gray-400">{formatBytes(selected.size)}</span>
              <Tooltip title="在系统中打开">
                <Button size="small" type="text" icon={<ExportOutlined />} onClick={() => void handleOpenExternal(selected.relPath)} />
              </Tooltip>
              <Tooltip title="在文件管理器中显示">
                <Button size="small" type="text" icon={<FileSearchOutlined />} onClick={() => void handleReveal(selected.relPath)} />
              </Tooltip>
            </div>
          )}
          <div className="flex-1 min-h-0 overflow-hidden">{renderPreviewContent()}</div>
        </div>
      </div>
    </div>
  )
}
