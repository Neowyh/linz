import { EventEmitter } from 'node:events'
import type { CordisContext, DshLogger, WebServerService, SessionService, WorkspaceService } from './types'
import type { WebServerShim } from './web-server'

/**
 * Cordis context implementation.
 *
 * Ties together the web server, session service, workspace service, and
 * provides the `effect()` / `on()` / `logger` / `emit()` surface that DSH
 * plugins expect from the host context (`ctx`).
 *
 * Disposal runs all registered `effect()` cleanup callbacks in reverse
 * registration order, then stops the web server.
 */
export class CordisContextImpl implements CordisContext {
  readonly webServer: WebServerService
  readonly sessions: SessionService
  readonly workspaces: WorkspaceService
  readonly logger: DshLogger

  private readonly emitter: EventEmitter
  private readonly disposers = new Map<string, () => void>()
  private disposed = false

  constructor(
    webServerShim: WebServerShim,
    sessions: SessionService,
    workspaces: WorkspaceService,
    emitter?: EventEmitter
  ) {
    this.webServer = webServerShim
    this.sessions = sessions
    this.workspaces = workspaces
    this.emitter = emitter ?? new EventEmitter()
    this.logger = {
      info: (...args: unknown[]) => console.log('[DSH]', ...args),
      warn: (...args: unknown[]) => console.warn('[DSH]', ...args),
      error: (...args: unknown[]) => console.error('[DSH]', ...args),
      debug: (...args: unknown[]) => {
        if (process.env.DSH_DEBUG) console.debug('[DSH]', ...args)
      }
    }
    // Allow many listeners for session/event bursts
    this.emitter.setMaxListeners(50)
  }

  effect(fn: () => (() => void) | void, name: string): void {
    if (this.disposed) return
    const dispose = fn()
    if (typeof dispose === 'function') {
      this.disposers.set(name, dispose)
    }
  }

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (this.disposed) return
    this.emitter.on(event, handler)
  }

  emit(event: string, ...args: unknown[]): void {
    if (this.disposed) return
    this.emitter.emit(event, ...args)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true

    // Run disposers in reverse registration order
    const names = [...this.disposers.keys()].reverse()
    for (const name of names) {
      try {
        this.disposers.get(name)?.()
      } catch (err) {
        console.warn(`[DSH] disposer "${name}" error:`, err)
      }
    }
    this.disposers.clear()
    this.emitter.removeAllListeners()
  }
}
