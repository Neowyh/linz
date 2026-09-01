import http from 'node:http'
import type { RouteRegistration, DshRequest, DshResponse, WebServerService } from './types'

/**
 * Embedded localhost HTTP server.
 *
 * Replaces DSH's `ctx.webServer.register()` so server-side DSH plugins can
 * mount HTTP routes (SPA pages, REST APIs, static assets) inside the
 * Electron main process. Binds to 127.0.0.1 on a random port to avoid
 * conflicts and never exposes routes to the network.
 */
export class WebServerShim implements WebServerService {
  private readonly server: http.Server
  private readonly exactRoutes = new Map<string, RouteRegistration>()
  private readonly prefixRoutes: RouteRegistration[] = []
  private port = 0

  constructor() {
    this.server = http.createServer((req, res) => this.handle(req, res))
  }

  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', () => {
        this.server.removeListener('error', reject)
        const addr = this.server.address()
        this.port = typeof addr === 'object' && addr ? addr.port : 0
        resolve()
      })
    })
  }

  register(route: RouteRegistration): void {
    if (route.kind === 'prefix') {
      this.prefixRoutes.push(route)
    } else {
      this.exactRoutes.set(route.path, route)
    }
  }

  unregister(path: string): void {
    this.exactRoutes.delete(path)
    const before = this.prefixRoutes.length
    for (let i = this.prefixRoutes.length - 1; i >= 0; i--) {
      if (this.prefixRoutes[i].path === path) this.prefixRoutes.splice(i, 1)
    }
    void before
  }

  getPort(): number {
    return this.port
  }

  getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve())
    })
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = req.url ?? '/'
    const pathname = new URL(url, 'http://dsh.local').pathname

    // Exact match first
    const exact = this.exactRoutes.get(pathname)
    if (exact) {
      return this.dispatch(exact, req, res)
    }

    // Then prefix match (longest prefix wins)
    let best: RouteRegistration | undefined
    for (const route of this.prefixRoutes) {
      if (pathname.startsWith(route.path)) {
        if (!best || route.path.length > best.path.length) best = route
      }
    }
    if (best) return this.dispatch(best, req, res)

    res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: 'Not found' }))
  }

  private async dispatch(route: RouteRegistration, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const dshReq: DshRequest = {
      method: req.method ?? 'GET',
      url: req.url,
      headers: req.headers as Record<string, string | string[] | undefined>
    }
    const dshRes: DshResponse = {
      writeHead: (status, headers) => {
        res.writeHead(status, headers ?? {})
      },
      end: (data) => {
        res.end(data)
      }
    }
    try {
      await route.handler(dshReq, dshRes)
    } catch (err) {
      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ error: 'Internal server error' }))
      }
      console.error('[DSH WebServer] route handler error:', err)
    }
  }
}
