import { useEffect, useRef, useState, useCallback } from 'react'
import { Input, Button } from 'antd'
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ReloadOutlined,
  HomeOutlined
} from '@ant-design/icons'
import { useUIStore } from '../../stores/uiStore'

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
  addEventListener(type: string, listener: (e: any) => void): void
  removeEventListener(type: string, listener: (e: any) => void): void
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
  const webviewRef = useRef<WebviewElement | null>(null)
  const isResizing = useUIStore((s) => s.isPanelResizing)
  const [currentUrl, setCurrentUrl] = useState<string>(HOME_URL)
  const [inputUrl, setInputUrl] = useState<string>(HOME_URL)
  const [canGoBack, setCanGoBack] = useState<boolean>(false)
  const [canGoForward, setCanGoForward] = useState<boolean>(false)
  const [loading, setLoading] = useState<boolean>(false)

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const syncState = (): void => {
      setCurrentUrl(webview.src)
      setInputUrl(webview.src)
      setCanGoBack(webview.canGoBack())
      setCanGoForward(webview.canGoForward())
    }

    const injectScrollbar = (): void => {
      webview.insertCSS(SCROLLBAR_CSS).catch(() => {
        // 某些页面(如 about:blank)可能不支持,忽略
      })
    }

    const handleNavigate = (e: any): void => {
      syncState()
    }
    const handleInPage = (e: any): void => {
      syncState()
    }
    const handleStart = (): void => setLoading(true)
    const handleStop = (): void => {
      setLoading(false)
      syncState()
      injectScrollbar()
    }
    const handleDomReady = (): void => {
      injectScrollbar()
    }
    // 拦截 webview 内部发起的非 http(s) 导航（如 JS redirect 到 file://）
    const handleWillNavigate = (e: any): void => {
      const url: string = e?.url || ''
      if (url && !/^https?:\/\//i.test(url)) {
        console.warn('[BrowserPanel] Blocked in-webview navigation to non-http URL:', url)
        e.preventDefault?.()
      }
    }
    // 注意：target="_blank" / window.open 的跳转不在此处处理——
    // Electron 22 已移除 webview 的 new-window 事件，由主进程
    // web-contents-created → setWindowOpenHandler 统一改为 webview 内打开（见 src/main/index.ts）

    webview.addEventListener('dom-ready', handleDomReady)
    webview.addEventListener('did-navigate', handleNavigate)
    webview.addEventListener('did-navigate-in-page', handleInPage)
    webview.addEventListener('did-start-loading', handleStart)
    webview.addEventListener('did-stop-loading', handleStop)
    webview.addEventListener('will-navigate', handleWillNavigate)

    return () => {
      webview.removeEventListener('dom-ready', handleDomReady)
      webview.removeEventListener('did-navigate', handleNavigate)
      webview.removeEventListener('did-navigate-in-page', handleInPage)
      webview.removeEventListener('did-start-loading', handleStart)
      webview.removeEventListener('did-stop-loading', handleStop)
      webview.removeEventListener('will-navigate', handleWillNavigate)
    }
  }, [])

  const handleNavigate = useCallback((rawUrl: string) => {
    const url = normalizeUrl(rawUrl)
    const webview = webviewRef.current
    if (webview) {
      webview.src = url
    }
    setCurrentUrl(url)
  }, [])

  const handleBack = useCallback(() => {
    webviewRef.current?.goBack()
  }, [])

  const handleForward = useCallback(() => {
    webviewRef.current?.goForward()
  }, [])

  const handleReload = useCallback(() => {
    webviewRef.current?.reload()
  }, [])

  const handleHome = useCallback(() => {
    handleNavigate(HOME_URL)
  }, [handleNavigate])

  return (
    <div className="flex flex-col h-full bg-white">
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-gray-200 bg-gray-50">
        <Button
          type="text"
          size="small"
          icon={<ArrowLeftOutlined />}
          onClick={handleBack}
          disabled={!canGoBack}
          title="后退"
        />
        <Button
          type="text"
          size="small"
          icon={<ArrowRightOutlined />}
          onClick={handleForward}
          disabled={!canGoForward}
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
            loading ? (
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
        <webview
          ref={webviewRef as any}
          src={currentUrl}
          className="w-full h-full"
          style={{
            display: isResizing ? 'none' : 'inline-flex',
            width: '100%',
            height: '100%'
          }}
          allowpopups
          // file:// 及非 http(s) 协议由 normalizeUrl + will-navigate 监听器拦截
        />
      </div>
    </div>
  )
}
