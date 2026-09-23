import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Spin, Empty } from 'antd'
import type { PanelTypeId } from '../../dock/types'
import { useDshStore } from '../../stores/dshStore'

interface SynapsePanelProps {
  instanceId: string
  panelType: PanelTypeId
}

/**
 * DSH Synapse panel — loads the conversation-map host page in a webview.
 *
 * The host page is served by the DSH shim's embedded HTTP server at
 * `http://localhost:{port}/synapse-host`. It renders the SPA in a
 * full-viewport iframe with the left sidebar hidden via CSS injection.
 *
 * When a card is clicked, the bridge calls `bridge.openSession(sessionId)`
 * which sends a `dsh:openSessionRequest` to the main window. This component
 * listens for that request and navigates to `/chat/{sessionId}` — the same
 * route-based mechanism the conversation list sidebar uses.
 */
export default function SynapsePanel({ panelType: _panelType }: SynapsePanelProps): JSX.Element {
  const { port } = useDshStore()
  const [preloadPath, setPreloadPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const navigate = useNavigate()
  const webviewRef = useRef<HTMLWebViewElement>(null)

  useEffect(() => {
    let cancelled = false
    let retries = 0
    const maxRetries = 6
    const retryDelayMs = 500

    // initDshShim() 在主进程是异步启动的，应用刚启动时 port 可能为 0。
    // 用重试机制等待 DSH 兼容层就绪，避免面板永久卡在"未初始化"空状态。
    const fetchConfig = async (): Promise<void> => {
      try {
        const config = await window.aeromind.dsh.getConfig()
        if (cancelled) return
        if (!config.port && retries < maxRetries) {
          retries++
          setTimeout(fetchConfig, retryDelayMs)
          return
        }
        useDshStore.setState({ port: config.port })
        setPreloadPath(config.preloadPath)
        setLoading(false)
      } catch {
        if (cancelled) return
        if (retries < maxRetries) {
          retries++
          setTimeout(fetchConfig, retryDelayMs)
          return
        }
        setLoading(false)
      }
    }

    fetchConfig()

    // When a card is clicked in the map, switch to that conversation
    // in the main chat sidebar via react-router navigation.
    const unsubscribe = window.aeromind.dsh.onOpenSessionRequest((sessionId) => {
      navigate(`/chat/${sessionId}`)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [navigate])

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Spin tip="正在初始化会话地图..." />
      </div>
    )
  }

  if (!port || !preloadPath) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <Empty description="DSH 兼容层未初始化。请确保已安装 DSH 插件。" />
      </div>
    )
  }

  const hostUrl = `http://127.0.0.1:${port}/synapse-host`

  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <webview
        ref={webviewRef}
        src={hostUrl}
        preload={`file://${preloadPath.replace(/\\/g, '/')}`}
        style={{ width: '100%', height: '100%', border: 'none', display: 'inline-flex' }}
      />
    </div>
  )
}
