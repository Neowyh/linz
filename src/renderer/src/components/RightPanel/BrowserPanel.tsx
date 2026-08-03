import { useEffect, useRef, useState, useCallback } from 'react'
import { Input, Button } from 'antd'
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  HomeOutlined,
  PlusOutlined,
  CloseOutlined
} from '@ant-design/icons'
import { useUIStore } from '../../stores/uiStore'
import { registerWebview, unregisterWebview, getWebviewHandler } from './webviewRegistry'

const HOME_URL = 'https://www.bing.com'

function normalizeUrl(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return HOME_URL
  // Only allow http(s) — explicitly reject file://, javascript:, data: etc.
  // to prevent local-file reads and other protocol-based attacks from the webview.
  if (/^https?:\/\//i.test(trimmed)) return trimmed
  if (/^file:\/\//i.test(trimmed)) {
    console.warn('[BrowserPanel] Blocked file:// URL:', trimmed)
    return HOME_URL
  }
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    console.warn('[BrowserPanel] Blocked non-http protocol:', trimmed)
    return HOME_URL
  }
  if (/^[\w-]+(\.[\w-]+)+/.test(trimmed)) {
    return `https://${trimmed}`
  }
  return `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`
}

interface WebviewElement extends HTMLElement {
  src: string
  canGoBack(): boolean
  canGoForward(): boolean
  goBack(): void
  goForward(): void
  reload(): void
  insertCSS(css: string): Promise<string>
  executeJavaScript(code: string): Promise<unknown>
  getWebContentsId(): number
  addEventListener(type: string, listener: (e: any) => void): void
  removeEventListener(type: string, listener: (e: any) => void): void
}

interface TabState {
  id: string
  /** 传给 webview 的 src 属性，仅显式导航时更新，避免 did-navigate 回写导致重复加载 */
  src: string
  /** 当前实际地址（展示用） */
  url: string
  title: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
}

let tabIdCounter = 0
function createTabId(): string {
  tabIdCounter += 1
  return `browser-tab-${Date.now()}-${tabIdCounter}`
}

const SCROLLBAR_CSS = `
::-webkit-scrollbar {
  width: 12px !important;
  height: 12px !important;
  -webkit-appearance: none !important;
}
::-webkit-scrollbar-track {
  background: #f1f1f1 !important;
}
::-webkit-scrollbar-thumb {
  background: #c1c1c1 !important;
  border-radius: 6px !important;
  border: 2px solid #f1f1f1 !important;
}
::-webkit-scrollbar-thumb:hover {
  background: #a8a8a8 !important;
}
::-webkit-scrollbar-corner {
  background: #f1f1f1 !important;
}
html, body {
  scrollbar-width: thin !important;
  scrollbar-color: #c1c1c1 #f1f1f1 !important;
}
`

export default function BrowserPanel(): JSX.Element {
  const isResizing = useUIStore((s) => s.isPanelResizing)

  const initialTabRef = useRef<TabState | null>(null)
  if (initialTabRef.current === null) {
    initialTabRef.current = {
      id: createTabId(),
      src: HOME_URL,
      url: HOME_URL,
      title: '新标签页',
      loading: false,
      canGoBack: false,
      canGoForward: false
    }
  }

  const [tabs, setTabs] = useState<TabState[]>(() => [initialTabRef.current!])
  const [activeTabId, setActiveTabId] = useState<string>(() => initialTabRef.current!.id)
  const [inputUrl, setInputUrl] = useState<string>(HOME_URL)

  const webviewRefs = useRef(new Map<string, WebviewElement>())
  const guestIdsByTab = useRef(new Map<string, number>())
  const wiredWebviews = useRef(new WeakSet<WebviewElement>())
  const refCallbacks = useRef(new Map<string, (el: WebviewElement | null) => void>())
  const tabsRef = useRef(tabs)
  const activeTabIdRef = useRef(activeTabId)

  useEffect(() => {
    tabsRef.current = tabs
  }, [tabs])
  useEffect(() => {
    activeTabIdRef.current = activeTabId
  }, [activeTabId])

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0]

  const createTab = useCallback(
    (url: string): TabState => ({
      id: createTabId(),
      src: url,
      url,
      title: '新标签页',
      loading: false,
      canGoBack: false,
      canGoForward: false
    }),
    []
  )

  const openNewTab = useCallback(
    (url?: string) => {
      const target = url ?? HOME_URL
      const tab = createTab(target)
      setTabs((prev) => [...prev, tab])
      setActiveTabId(tab.id)
      setInputUrl(target)
    },
    [createTab]
  )

  // 每个页签的 webview 只接线一次；回调全部依赖稳定引用（refs + 函数式 setState），
  // 所以首个渲染创建的回调闭包即使跨渲染复用也始终读到最新状态。
  const wireWebview = (tabId: string, wv: WebviewElement): void => {
    if (wiredWebviews.current.has(wv)) return
    wiredWebviews.current.add(wv)

    const updateTab = (partial: Partial<TabState>): void => {
      setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, ...partial } : t)))
    }
    const syncNav = (): void => {
      let back = false
      let fwd = false
      try {
        back = wv.canGoBack()
        fwd = wv.canGoForward()
      } catch {
        // webview 未完全 attach 时可能抛错，忽略
      }
      updateTab({ url: wv.src, canGoBack: back, canGoForward: fwd })
      if (activeTabIdRef.current === tabId) {
        setInputUrl(wv.src)
      }
    }
    const injectScrollbar = (): void => {
      wv.insertCSS(SCROLLBAR_CSS).catch(() => {
        // 某些页面(如 about:blank)可能不支持,忽略
      })
    }

    wv.addEventListener('did-attach', () => {
      try {
        const guestId = wv.getWebContentsId()
        guestIdsByTab.current.set(tabId, guestId)
        // 主进程 window.open 事件 → guestId → 回到本页签所在面板新建标签页
        registerWebview(guestId, (url) => openNewTab(url))
      } catch {
        // 忽略
      }
    })
    wv.addEventListener('page-title-updated', (e: any) => {
      updateTab({ title: e?.title || '新标签页' })
    })
    wv.addEventListener('did-navigate', syncNav)
    wv.addEventListener('did-navigate-in-page', syncNav)
    wv.addEventListener('did-start-loading', () => updateTab({ loading: true }))
    wv.addEventListener('did-stop-loading', () => {
      updateTab({ loading: false })
      syncNav()
      injectScrollbar()
    })
    wv.addEventListener('dom-ready', injectScrollbar)
    // 拦截 webview 内部发起的非 http(s) 导航（如 JS redirect 到 file://）
    wv.addEventListener('will-navigate', (e: any) => {
      const url: string = e?.url || ''
      if (url && !/^https?:\/\//i.test(url)) {
        console.warn('[BrowserPanel] Blocked in-webview navigation to non-http URL:', url)
        e.preventDefault?.()
      }
    })
  }

  const getRefCallback = (tabId: string): ((el: WebviewElement | null) => void) => {
    let cb = refCallbacks.current.get(tabId)
    if (!cb) {
      cb = (el) => {
        if (el) {
          // allowpopups 通过下方 JSX 属性设置，React 在元素插入 DOM（guest 创建）前就 setAttribute，
          // window.open/target=_blank 才不被静默拦截；ref 回调此时已晚于 guest 创建，不生效。
          webviewRefs.current.set(tabId, el)
          wireWebview(tabId, el)
        } else {
          webviewRefs.current.delete(tabId)
        }
      }
      refCallbacks.current.set(tabId, cb)
    }
    return cb
  }

  // 主进程 window.open → browser:openInNewTab → guestId 定位到本面板的页签
  useEffect(() => {
    const off = window.aeromind.browser.onOpenInNewTab((data) => {
      const handler = getWebviewHandler(data.guestId)
      if (handler) handler(data.url)
    })
    return off
  }, [])

  // 卸载时注销所有注册的 guestId
  useEffect(() => {
    return () => {
      guestIdsByTab.current.forEach((guestId) => unregisterWebview(guestId))
      guestIdsByTab.current.clear()
    }
  }, [])

  // 切换激活页签时同步地址栏
  useEffect(() => {
    const tab = tabsRef.current.find((t) => t.id === activeTabId)
    if (tab) setInputUrl(tab.url)
  }, [activeTabId])

  const handleNavigate = useCallback((rawUrl: string) => {
    const url = normalizeUrl(rawUrl)
    const tabId = activeTabIdRef.current
    const webview = webviewRefs.current.get(tabId)
    if (webview) {
      webview.src = url
    }
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, src: url, url } : t)))
    setInputUrl(url)
  }, [])

  const handleBack = useCallback(() => {
    webviewRefs.current.get(activeTabIdRef.current)?.goBack()
  }, [])

  const handleForward = useCallback(() => {
    webviewRefs.current.get(activeTabIdRef.current)?.goForward()
  }, [])

  const handleReload = useCallback(() => {
    webviewRefs.current.get(activeTabIdRef.current)?.reload()
  }, [])

  const handleHome = useCallback(() => {
    handleNavigate(HOME_URL)
  }, [handleNavigate])

  const closeTab = useCallback((tabId: string) => {
    const guestId = guestIdsByTab.current.get(tabId)
    if (guestId) unregisterWebview(guestId)
    guestIdsByTab.current.delete(tabId)
    refCallbacks.current.delete(tabId)

    const current = tabsRef.current
    const idx = current.findIndex((t) => t.id === tabId)
    if (idx === -1) return
    const remaining = current.filter((t) => t.id !== tabId)

    if (remaining.length === 0) {
      // 关掉最后一个页签时自动新建主页页签（浏览器惯例）
      const fresh = createTab(HOME_URL)
      setTabs([fresh])
      setActiveTabId(fresh.id)
      setInputUrl(HOME_URL)
      return
    }
    setTabs(remaining)
    if (activeTabIdRef.current === tabId) {
      // 优先激活右侧相邻页签，最后一个则激活左侧
      const next = remaining[Math.min(idx, remaining.length - 1)]
      setActiveTabId(next.id)
      setInputUrl(next.url)
    }
  }, [createTab])

  return (
    <div className="flex flex-col h-full bg-white">
      {/* 页签栏 */}
      <div className="flex items-center gap-1 px-2 pt-1.5 border-b border-gray-200 bg-gray-100 overflow-x-auto flex-shrink-0">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            onClick={() => setActiveTabId(tab.id)}
            className={`group flex items-center gap-1 pl-2 pr-1 py-1 rounded-t text-xs cursor-pointer border transition-colors flex-shrink-0 max-w-[160px] ${
              tab.id === activeTabId
                ? 'bg-white text-gray-800 border-gray-200'
                : 'bg-transparent text-gray-500 hover:bg-gray-200 border-transparent'
            }`}
            title={tab.url}
          >
            {tab.loading && (
              <ReloadOutlined className="text-[10px] animate-spin text-primary" />
            )}
            <span className="truncate">{tab.title || '新标签页'}</span>
            <button
              onClick={(e) => {
                e.stopPropagation()
                closeTab(tab.id)
              }}
              className="opacity-50 group-hover:opacity-100 hover:text-red-500 transition-opacity p-0.5"
              title="关闭标签页"
            >
              <CloseOutlined style={{ fontSize: 10 }} />
            </button>
          </div>
        ))}
        <button
          onClick={() => openNewTab()}
          className="flex items-center justify-center w-6 h-6 mb-1 rounded text-gray-500 hover:text-primary hover:bg-gray-200 transition-colors flex-shrink-0"
          title="新建标签页"
        >
          <PlusOutlined style={{ fontSize: 12 }} />
        </button>
      </div>

      {/* 地址栏 */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          onClick={handleBack}
          disabled={!activeTab?.canGoBack}
          title="后退"
        />
        <Button
          type="text"
          size="small"
          icon={<ArrowRightOutlined />}
          onClick={handleForward}
          disabled={!activeTab?.canGoForward}
          title="前进"
        />
        <Button
          type="text"
          size="small"
          icon={<ReloadOutlined />}
          onClick={handleReload}
          title="刷新"
        />
        <Button
          type="text"
          size="small"
          icon={<HomeOutlined />}
          onClick={handleHome}
          title="主页"
        />
        <Input
          size="small"
          value={inputUrl}
          onChange={(e) => setInputUrl(e.target.value)}
          onPressEnter={(e) => handleNavigate((e.target as HTMLInputElement).value)}
          placeholder="输入网址或搜索"
          className="flex-1"
          suffix={
            activeTab?.loading ? (
              <ReloadOutlined className="text-primary animate-spin" />
            ) : (
              <span className="inline-block w-3" />
            )
          }
        />
      </div>

      <div className="flex-1 overflow-hidden bg-white relative">
        {isResizing && (
          <div className="absolute inset-0 bg-gray-50 flex items-center justify-center text-xs text-gray-400 z-10">
            拖拽中...
          </div>
        )}
        {tabs.map((tab) => (
          <webview
            key={tab.id}
            ref={getRefCallback(tab.id) as any}
            src={tab.src}
            // 字符串值 → React 走 setAttribute（guest 用 hasAttribute('allowpopups') 判定），
            // 且在元素插入 DOM（guest 创建）之前设置；布尔值只会赋 property，不产生属性。
            // @types/react 把 allowpopups 定为 boolean，这里用空串属性形式并断言类型。
            allowpopups={'' as any}
            className="w-full h-full"
            style={{
              display: tab.id === activeTabId ? 'inline-flex' : 'none',
              width: '100%',
              height: '100%'
            }}
            // file:// 及非 http(s) 协议由 normalizeUrl + will-navigate 监听器拦截
          />
        ))}
      </div>
    </div>
  )
}
