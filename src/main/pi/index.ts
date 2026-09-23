// Pi SDK 动态 import 入口
//
// @earendil-works/pi-coding-agent 是 ESM-only 包，Electron main 进程是 CJS，
// 必须用 await import() 动态加载（参考 src/main/embedding/index.ts 的处理方式）。
// 三态降级：null=未尝试 / true=可用 / false=加载失败

type PiModule = typeof import('@earendil-works/pi-coding-agent')

let piModule: PiModule | null = null
let piAvailable: boolean | null = null
let loadError: string | null = null

// Polyfill: Pi 自带的 undici 8.5.0 从 node:worker_threads 取 markAsUncloneable，
// 但该 API 在 Node 22.x 才加入。Electron 31 内置 Node 20.18.x 没有，
// 会导致 `webidl.util.markAsUncloneable is not a function`。
// undici 仅用它把 Headers/FormData 等标记为 postMessage 不可克隆（防御性），
// 我们从不 postMessage 这些对象，no-op polyfill 安全。
function polyfillNode20Compat(): void {
  try {
    const workerThreads = require('node:worker_threads')
    if (typeof workerThreads.markAsUncloneable !== 'function') {
      workerThreads.markAsUncloneable = function markAsUncloneable() { /* no-op */ }
    }
  } catch {
    /* node:worker_threads 应当始终可用，忽略 */
  }
  // diagnostics_channel.tracingChannel：Node 19+/20+ 引入，Electron 22 (Node 16.17.1) 缺失。
  // lru-cache（pi-tui/pi-coding-agent 依赖）模块加载时顶层调用 tracingChannel('lru-cache')，
  // 缺失则抛 "tracingChannel is not a function"。polyfill 为 no-op TracingChannel：
  // hasSubscribers=false 使性能追踪路径短路，tracePromise/traceSync 直接执行原函数。
  try {
    const dc = require('node:diagnostics_channel')
    if (typeof dc.tracingChannel !== 'function') {
      dc.tracingChannel = function tracingChannel() {
        return {
          hasSubscribers: false,
          tracePromise: async (fn: any) => fn(),
          traceSync: (fn: any) => fn(),
          subscribe: () => {},
          unsubscribe: () => {}
        }
      }
    }
  } catch {
    /* node:diagnostics_channel 应当始终可用，忽略 */
  }
}

export async function ensurePi(): Promise<PiModule> {
  if (piModule) return piModule
  if (piAvailable === false) {
    throw new Error(`Pi SDK unavailable: ${loadError || 'unknown error'}`)
  }
  try {
    polyfillNode20Compat()
    piModule = await import(/* @vite-ignore */ '@earendil-works/pi-coding-agent')
    piAvailable = true
    console.log('[Pi] SDK loaded successfully')
    return piModule
  } catch (err) {
    piAvailable = false
    loadError = err instanceof Error ? err.message : String(err)
    console.warn('[Pi] SDK load failed:', loadError)
    throw err
  }
}

export function isPiAvailable(): boolean {
  return piAvailable === true
}

export function getPiLoadError(): string | null {
  return loadError
}
