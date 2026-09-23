import { EventEmitter } from 'node:events'
import type { BrowserWindow } from 'electron'
import { WebServerShim } from './web-server'
import { SessionServiceImpl } from './session-service'
import { WorkspaceServiceImpl } from './workspace-service'
import { CordisContextImpl } from './cordis-context'
import { EventBridge } from './event-bridge'
import { PluginLoader } from './plugin-loader'
import { runStream } from './run-stream'
import { buildHostPage } from './host-page-builder'
import type { CordisContext } from './types'
import type { SessionServiceImpl as SessionServiceImplType } from './session-service'
import type { WorkspaceServiceImpl as WorkspaceServiceImplType } from './workspace-service'

let dshContext: CordisContextImpl | null = null
let dshWebServer: WebServerShim | null = null
let dshEventBridge: EventBridge | null = null
let dshSessionService: SessionServiceImplType | null = null
let dshWorkspaceService: WorkspaceServiceImplType | null = null
let dshPluginLoader: PluginLoader | null = null
let dshEmitter: EventEmitter | null = null
let mainWindowGetter: (() => BrowserWindow | null) | null = null

/**
 * Initialize the DSH compatibility shim.
 *
 * Creates the embedded HTTP server, reactive session/workspace services,
 * Cordis context, event bridge, and plugin loader. Loads all DSH plugins
 * from `userData/dsh-plugins/`. Must be called after IPC registration and
 * main window creation.
 */
export async function initDshShim(getMainWindow: () => BrowserWindow | null): Promise<void> {
  if (dshContext) {
    console.warn('[DSH] Shim already initialized')
    return
  }

  mainWindowGetter = getMainWindow

  // ── Shared event bus ──────────────────────────────────────
  // All services emit through this emitter; the Cordis context wraps it
  // so plugins can subscribe via ctx.on().
  dshEmitter = new EventEmitter()
  dshEmitter.setMaxListeners(50)
  const emitFn = (event: string, ...args: unknown[]): void => {
    dshEmitter!.emit(event, ...args)
  }

  // ── Web server ─────────────────────────────────────────────
  dshWebServer = new WebServerShim()
  await dshWebServer.start()
  console.log(`[DSH] Web server listening on ${dshWebServer.getBaseUrl()}`)

  // ── Event bridge ──────────────────────────────────────────
  dshEventBridge = new EventBridge(emitFn)

  // ── Session service ───────────────────────────────────────
  // runStream is the shared streaming pipeline — both chat:sendMessage
  // (Phase 2) and dsh:prompt call it. It persists messages, runs the agent
  // engine, forwards chunks to the renderer, and emits DSH events.
  dshSessionService = new SessionServiceImpl({
    emit: emitFn,
    runStream: (conversationId, text) =>
      runStream(conversationId, text, {
        getMainWindow: () => mainWindowGetter?.() ?? null,
        eventBridge: dshEventBridge!,
        sessionService: dshSessionService!
      })
  })

  // ── Workspace service ─────────────────────────────────────
  dshWorkspaceService = new WorkspaceServiceImpl()

  // ── Cordis context ────────────────────────────────────────
  dshContext = new CordisContextImpl(
    dshWebServer,
    dshSessionService,
    dshWorkspaceService,
    dshEmitter
  )

  // ── Plugin loader ─────────────────────────────────────────
  dshPluginLoader = new PluginLoader(dshContext)
  await dshPluginLoader.startAll()

  // ── Host page route ──────────────────────────────────────
  // Serves the HTML host page that wraps the plugin SPA in an iframe.
  // The bridge script uses window.dshBridge (from the webview preload)
  // to communicate with the main process.
  dshWebServer.register({
    kind: 'exact',
    path: '/synapse-host',
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      res.end(buildHostPage('/synapse/'))
    }
  })

  console.log('[DSH] Shim initialized, plugins loaded:', dshPluginLoader.listPlugins().map((p) => p.name))
}

/**
 * Dispose the DSH shim: unload plugins, close the HTTP server.
 */
export async function disposeDshShim(): Promise<void> {
  if (dshContext) {
    dshContext.dispose()
    dshContext = null
  }
  if (dshPluginLoader) {
    dshPluginLoader = null
  }
  if (dshWebServer) {
    await dshWebServer.stop()
    dshWebServer = null
  }
  dshEventBridge = null
  dshSessionService = null
  dshWorkspaceService = null
  dshEmitter = null
  mainWindowGetter = null
}

/** Returns the HTTP server port (for constructing webview URLs). */
export function getDshPort(): number {
  return dshWebServer?.getPort() ?? 0
}

/** Returns the HTTP server base URL. */
export function getDshBaseUrl(): string {
  return dshWebServer?.getBaseUrl() ?? 'http://127.0.0.1:0'
}

/** Returns the Cordis context (for IPC handlers that need to interact with plugins). */
export function getDshContext(): CordisContext | null {
  return dshContext
}

/** Returns the event bridge (for chat.ipc.ts to hook into the streaming pipeline). */
export function getEventBridge(): EventBridge | null {
  return dshEventBridge
}

/** Returns the session service (for dsh.ipc.ts handlers). */
export function getSessionService(): SessionServiceImplType | null {
  return dshSessionService
}

/** Returns the workspace service (for dsh.ipc.ts handlers). */
export function getWorkspaceService(): WorkspaceServiceImplType | null {
  return dshWorkspaceService
}

/** Returns the plugin loader (for dsh.ipc.ts handlers). */
export function getPluginLoader(): PluginLoader | null {
  return dshPluginLoader
}

/** Returns the web server shim (for registering host page routes). */
export function getWebServer(): WebServerShim | null {
  return dshWebServer
}

export type { CordisContextImpl }
