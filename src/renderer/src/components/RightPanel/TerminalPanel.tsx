import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

export default function TerminalPanel(): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const termRef = useRef<Terminal | null>(null)
  const sessionIdRef = useRef<string | null>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new Terminal({
      fontFamily: 'Consolas, "Courier New", monospace',
      fontSize: 13,
      cursorBlink: true,
      theme: {
        background: '#1e1e2e',
        foreground: '#cdd6f4',
        cursor: '#f5e0dc',
        selectionBackground: '#585b70'
      }
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    termRef.current = term

    let disposed = false
    let unsubscribeData: (() => void) | null = null
    let unsubscribeExit: (() => void) | null = null
    let resizeObserver: ResizeObserver | null = null
    let resizeTimer: ReturnType<typeof setTimeout> | null = null

    const init = async (): Promise<void> => {
      try {
        const { sessionId } = await window.aeromind.terminal.spawn({})
        if (disposed) {
          window.aeromind.terminal.kill(sessionId)
          return
        }
        sessionIdRef.current = sessionId

        term.onData((data) => {
          window.aeromind.terminal.write(sessionId, data)
        })

        unsubscribeData = window.aeromind.terminal.onData((payload) => {
          if (payload.sessionId === sessionId) {
            term.write(payload.data)
          }
        })

        unsubscribeExit = window.aeromind.terminal.onExit((payload) => {
          if (payload.sessionId === sessionId) {
            term.write(`\r\n\x1b[33m[进程已退出,代码 ${payload.exitCode}]\x1b[0m\r\n`)
          }
        })

        try {
          fitAddon.fit()
          window.aeromind.terminal.resize(sessionId, term.cols, term.rows)
        } catch {
          // fit 可能失败,忽略
        }
      } catch (err) {
        term.write(`\x1b[31m[终端启动失败: ${(err as Error).message}]\x1b[0m\r\n`)
      }
    }

    init()

    const scheduleResize = (): void => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => {
        try {
          fitAddon.fit()
          const sid = sessionIdRef.current
          if (sid) {
            window.aeromind.terminal.resize(sid, term.cols, term.rows)
          }
        } catch {
          // 忽略
        }
      }, 100)
    }

    if (typeof ResizeObserver !== 'undefined' && containerRef.current) {
      resizeObserver = new ResizeObserver(scheduleResize)
      resizeObserver.observe(containerRef.current)
    }

    return () => {
      disposed = true
      if (resizeTimer) clearTimeout(resizeTimer)
      if (resizeObserver) resizeObserver.disconnect()
      if (unsubscribeData) unsubscribeData()
      if (unsubscribeExit) unsubscribeExit()
      const sid = sessionIdRef.current
      if (sid) {
        try {
          window.aeromind.terminal.kill(sid)
        } catch {
          // 忽略
        }
      }
      term.dispose()
      termRef.current = null
      sessionIdRef.current = null
    }
  }, [])

  return <div ref={containerRef} className="w-full h-full bg-[#1e1e2e] overflow-hidden" />
}
