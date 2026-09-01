import { useEffect, useRef, useState } from 'react'
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
 * `http://localhost:{port}/synapse-host`. It contains a bridge script
 * that translates between AeroMind's `dshBridge` API (exposed by the
 * webview preload) and the SPA's `postMessage` protocol.
 *
 * The webview preload (`dsh-preload.js`) exposes `window.dshBridge` with
 * methods for session management (prompt, fork, create, open), workspace
 * listing, live-reply subscription, and theme syncing.
 */
export default function SynapsePanel({ panelType: _panelType }: SynapsePanelProps): JSX.Element {
  const { port, loadPort } = useDshStore()
  const [preloadPath, setPreloadPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const webviewRef = useRef<HTMLWebViewElement>(null)

  useEffect(() => {
    // Fetch both the port and preload path from the main process
    window.aeromind.dsh.getConfig().then((config) => {
      useDshStore.setState({ port: config.port })
      setPreloadPath(config.preloadPath)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })

    // Listen for "open session" requests from the webview
    // (when the user clicks a conversation card to open it in the chat view)
    const unsubscribe = window.aeromind.dsh.onOpenSessionRequest((sessionId) => {
      // Switch to the conversation in the chat view
      // This uses the same mechanism as the conversation list click
      const event = new CustomEvent('dsh:openConversation', { detail: sessionId })
      window.dispatchEvent(event)
    })

    return () => {
      unsubscribe()
    }
  }, [loadPort])

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
        // Electron 22 webview attributes
        // contextIsolation: true, nodeIntegration: false (default)
        // disablewebsecurity is NOT needed — same-origin localhost
      />
    </div>
  )
}
