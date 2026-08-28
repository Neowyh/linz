// 侧边栏浏览器控制会话（主进程）
// 由 browser 工具调用，直接驱动 Dock 浏览器面板里的 <webview> guest WebContents，
// 复用应用自带 Chromium，零新增二进制，Win7 兼容。
//
// 设计要点：
// - 激活页签由渲染端 BrowserPanel 通过 browser:activeTab IPC 上报（"最后上报者优先"），
//   每次动作前重新解析存活 + http(s) 校验，天然排除 FilePanel 的 file:// PDF webview
// - busy 锁串行化所有动作：浏览器界面是共享 UI，多 Agent 并发时必须排队
// - 动作全部基于固定 JS 片段（executeJavaScript + userGesture），无原始 JS 注入面；
//   selector/text 一律经 JSON.stringify 嵌入，避免字符串注入
// - 每个执行器 catch 一切异常并返回中文错误字符串，绝不 throw（工具契约只返回字符串）

import { BrowserWindow, webContents } from 'electron'
import type { WebContents } from 'electron'

let activeGuestId: number | null = null // BrowserPanel 最近上报的激活页签 guest
const knownGuestIds = new Set<number>() // 所有上报过的 guest（解析时校验存活）
let busy = false // 并发锁：浏览器界面是共享 UI

export interface BrowserActionParams {
  action: string
  url?: string
  selector?: string
  text?: string
  deltaY?: number
  timeoutMs?: number
}

const HTTP_RE = /^https?:\/\//i
const MAX_READ_CHARS = 8000 // read 正文截断（配合 stream-handler 的 MAX_TOOL_OUTPUT=10000）
const POLL_INTERVAL_MS = 250

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isAlive(wc: WebContents | null): wc is WebContents {
  return !!wc && !wc.isDestroyed()
}

/** 渲染端上报激活页签 guestId（null = 无激活页签） */
export function setActiveBrowserGuest(guestId: number | null): void {
  if (typeof guestId !== 'number' || guestId <= 0) {
    activeGuestId = null
    return
  }
  const wc = webContents.fromId(guestId)
  if (isAlive(wc) && wc.getType() === 'webview') {
    knownGuestIds.add(guestId)
    activeGuestId = guestId
  } else {
    activeGuestId = null
  }
}

/** 解析当前可操作的浏览器 WebContents（激活页签优先，兜底遍历已知存活页签） */
export function getActiveBrowserWebContents(): WebContents | null {
  // ① 最后上报的激活页签：存活 + 类型 webview + 当前 URL 为 http(s)
  if (activeGuestId !== null) {
    const wc = webContents.fromId(activeGuestId)
    if (isAlive(wc) && wc.getType() === 'webview' && HTTP_RE.test(wc.getURL())) {
      return wc
    }
  }
  // ② 兜底：knownGuestIds 中仍存活且为 http(s) 的 webview
  // （覆盖"激活页签销毁、另一页签存活"；file:// PDF webview 不在 knownGuestIds 中，且被 URL 过滤双重排除）
  for (const id of knownGuestIds) {
    const wc = webContents.fromId(id)
    if (isAlive(wc) && wc.getType() === 'webview' && HTTP_RE.test(wc.getURL())) {
      return wc
    }
  }
  return null
}

/** 通知渲染端打开/聚焦浏览器面板（App.tsx 常驻监听） */
export function openBrowserPanel(): void {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (win && !win.webContents.isDestroyed()) {
    win.webContents.send('browser:openPanel')
  }
}

/** 确保浏览器可用：无激活 webview 时自动打开面板并轮询等待其挂载 */
export async function ensureBrowserReady(timeoutMs = 10_000): Promise<WebContents | null> {
  const existing = getActiveBrowserWebContents()
  if (existing) return existing
  openBrowserPanel()
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS)
    const wc = getActiveBrowserWebContents()
    if (wc) return wc
  }
  return null
}

/** 等待页面加载完成；返回 null 表示正常，否则返回错误描述字符串 */
async function waitForLoad(wc: WebContents, timeoutMs = 30_000): Promise<string | null> {
  if (wc.isDestroyed()) return '浏览器页面已销毁'
  if (!wc.isLoading()) return null
  return new Promise((resolve) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      cleanup()
      resolve('页面加载超时（30s）')
    }, timeoutMs)
    const onStop = (): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(null)
    }
    const onFail = (_e: Event, code: number, desc: string): void => {
      if (settled) return
      settled = true
      cleanup()
      resolve(`页面加载失败（${code} ${desc}）`)
    }
    const cleanup = (): void => {
      clearTimeout(timer)
      wc.removeListener('did-stop-loading', onStop)
      wc.removeListener('did-fail-load', onFail)
    }
    wc.once('did-stop-loading', onStop)
    wc.once('did-fail-load', onFail)
  })
}

/** 在页面主框架执行 JS（userGesture=true，事件可带用户手势语义）；失败抛中文错误 */
async function runInPage(wc: WebContents, code: string): Promise<unknown> {
  if (wc.isDestroyed()) throw new Error('浏览器页面已销毁')
  try {
    return await wc.executeJavaScript(code, true)
  } catch (err: any) {
    throw new Error(`页面脚本执行失败: ${err?.message || String(err)}`)
  }
}

// ============ 动作执行器 ============

async function actionNavigate(p: BrowserActionParams): Promise<string> {
  const url = (p.url || '').trim()
  if (!url) return '❌ navigate 需要提供 url 参数'
  if (!HTTP_RE.test(url)) return `❌ 仅支持 http/https 网址: ${url}`
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    await wc.loadURL(url)
  } catch (err: any) {
    return `❌ 页面加载失败: ${err?.message || String(err)}`
  }
  const loadErr = await waitForLoad(wc)
  if (loadErr) return loadErr
  const title = wc.getTitle() ? `（标题：${wc.getTitle()}）` : ''
  return `✅ 已打开 ${wc.getURL()}${title}`
}

async function actionBackForward(p: BrowserActionParams, direction: 'back' | 'forward'): Promise<string> {
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  const canGo = direction === 'back' ? wc.canGoBack() : wc.canGoForward()
  if (!canGo) return `❌ 无法${direction === 'back' ? '后退' : '前进'}：没有${direction === 'back' ? '更早的' : '更新的'}历史记录`
  try {
    if (direction === 'back') wc.goBack()
    else wc.goForward()
  } catch (err: any) {
    return `❌ ${direction === 'back' ? '后退' : '前进'}失败: ${err?.message || String(err)}`
  }
  const loadErr = await waitForLoad(wc)
  if (loadErr) return loadErr
  return `✅ 已${direction === 'back' ? '后退' : '前进'}到 ${wc.getURL()}（标题：${wc.getTitle() || '未知'}）`
}

async function actionReload(): Promise<string> {
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    wc.reload()
  } catch (err: any) {
    return `❌ 刷新失败: ${err?.message || String(err)}`
  }
  const loadErr = await waitForLoad(wc)
  if (loadErr) return loadErr
  return `✅ 已刷新 ${wc.getURL()}（标题：${wc.getTitle() || '未知'}）`
}

// 完整 pointer/mouse 事件序列（scrollIntoView + 元素中心坐标），React 18 站点兼容；
// composed:true 允许事件穿过 shadow DOM 边界
function clickSnippet(selector: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return { ok: false, error: '未找到匹配元素: ' + ${JSON.stringify(selector)} }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  const r = el.getBoundingClientRect()
  const mk = (type, extra) => new MouseEvent(type, {
    bubbles: true, cancelable: true, composed: true, view: window,
    clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
    button: 0, buttons: 1, ...(extra || {})
  })
  el.dispatchEvent(mk('pointerdown', { pointerId: 1, pointerType: 'mouse', isPrimary: true }))
  el.dispatchEvent(mk('mousedown'))
  el.dispatchEvent(mk('pointerup', { pointerId: 1, pointerType: 'mouse', isPrimary: true }))
  el.dispatchEvent(mk('mouseup'))
  el.dispatchEvent(mk('click'))
  return { ok: true, tag: el.tagName.toLowerCase(), text: (el.innerText || el.textContent || '').trim().slice(0, 80) }
})()`
}

async function actionClick(p: BrowserActionParams): Promise<string> {
  const selector = (p.selector || '').trim()
  if (!selector) return '❌ click 需要提供 selector 参数（CSS 选择器）'
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    const result = (await runInPage(wc, clickSnippet(selector))) as { ok: boolean; error?: string; tag?: string; text?: string }
    if (!result?.ok) return `❌ 点击失败: ${result?.error || '未知错误'}`
    const text = result.text ? `（"${result.text}"）` : ''
    return `✅ 已点击 <${result.tag}>${text}`
  } catch (err: any) {
    return `❌ 点击失败: ${err?.message || String(err)}`
  }
}

// 原生 value setter + input/change 事件（React 受控输入框兼容）
function typeSnippet(selector: string, text: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return { ok: false, error: '未找到匹配元素: ' + ${JSON.stringify(selector)} }
  el.focus()
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const proto = el instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(text)})
  } else {
    el.value = ${JSON.stringify(text)}
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  el.dispatchEvent(new Event('change', { bubbles: true }))
  return { ok: true, tag: el.tagName.toLowerCase() }
})()`
}

async function actionType(p: BrowserActionParams): Promise<string> {
  const selector = (p.selector || '').trim()
  const text = p.text ?? ''
  if (!selector) return '❌ type 需要提供 selector 参数（CSS 选择器）'
  if (!text) return '❌ type 需要提供 text 参数（要输入的文本）'
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    const result = (await runInPage(wc, typeSnippet(selector, text))) as { ok: boolean; error?: string; tag?: string }
    if (!result?.ok) return `❌ 输入失败: ${result?.error || '未知错误'}`
    return `✅ 已在 <${result.tag}> 输入文本（${text.length} 字符）`
  } catch (err: any) {
    return `❌ 输入失败: ${err?.message || String(err)}`
  }
}

function scrollSnippet(selector?: string, deltaY?: number): string {
  if (selector) {
    return `(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return { ok: false, error: '未找到匹配元素: ' + ${JSON.stringify(selector)} }
  el.scrollIntoView({ block: 'center', inline: 'center' })
  return { ok: true, mode: 'selector', y: window.scrollY }
})()`
  }
  const dy = typeof deltaY === 'number' ? deltaY : 600
  return `(() => {
  window.scrollBy({ top: ${dy}, behavior: 'auto' })
  return { ok: true, mode: 'delta', y: window.scrollY }
})()`
}

async function actionScroll(p: BrowserActionParams): Promise<string> {
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  const selector = (p.selector || '').trim() || undefined
  try {
    const result = (await runInPage(wc, scrollSnippet(selector, p.deltaY))) as { ok: boolean; error?: string; mode?: string; y?: number }
    if (!result?.ok) return `❌ 滚动失败: ${result?.error || '未知错误'}`
    return result.mode === 'selector'
      ? `✅ 已滚动到元素 ${p.selector}（页面纵向位置 ${result.y}px）`
      : `✅ 已滚动 ${p.deltaY ?? 600}px（当前纵向位置 ${result.y}px）`
  } catch (err: any) {
    return `❌ 滚动失败: ${err?.message || String(err)}`
  }
}

function readSnippet(): string {
  return `(() => {
  const text = (document.body && (document.body.innerText || document.body.textContent)) || ''
  return { url: location.href, title: document.title, text: text.slice(0, ${MAX_READ_CHARS}) }
})()`
}

async function actionRead(): Promise<string> {
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    const r = (await runInPage(wc, readSnippet())) as { url?: string; title?: string; text?: string }
    if (!r || !r.url) return '❌ 读取页面失败：页面尚未就绪'
    return `📄 当前页面：${r.title || '（无标题）'}\n地址：${r.url}\n正文：\n${r.text || '（无正文文本）'}`
  } catch (err: any) {
    return `❌ 读取页面失败: ${err?.message || String(err)}`
  }
}

async function actionScreenshot(): Promise<string> {
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    const image = await wc.capturePage()
    if (image.isEmpty()) {
      return '❌ 截图失败：浏览器页面当前不可见（面板被隐藏或窗口最小化），请保持面板可见后重试。'
    }
    const size = image.getSize()
    const resized = size.width > 1280 ? image.resize({ width: 1280 }) : image
    const b64 = resized.toPNG().toString('base64')
    const rs = resized.getSize()
    return `✅ 已截取当前页面（${rs.width}×${rs.height}）。\n<<<IMAGE>>>data:image/png;base64,${b64}<<</IMAGE>>>`
  } catch (err: any) {
    return `❌ 截图失败: ${err?.message || String(err)}`
  }
}

async function actionWait(p: BrowserActionParams, signal?: AbortSignal): Promise<string> {
  const selector = (p.selector || '').trim()
  if (!selector) return '❌ wait 需要提供 selector 参数（CSS 选择器）'
  const timeoutMs = Math.min(Math.max(p.timeoutMs ?? 10_000, 1_000), 30_000)
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  const deadline = Date.now() + timeoutMs
  const check = `!!document.querySelector(${JSON.stringify(selector)})`
  while (Date.now() < deadline) {
    if (signal?.aborted) return '⏹ 操作已取消'
    try {
      const found = await runInPage(wc, check)
      if (found) return `✅ 元素已出现: ${selector}`
    } catch (err: any) {
      // 页面导航中/guest 销毁 → 继续等待（除非明确不可恢复）
      if (wc.isDestroyed()) return `❌ 等待失败: ${err?.message || String(err)}`
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return `⏱ 等待超时：${timeoutMs}ms 内未找到元素 ${selector}`
}

// ============ 总入口 ============

/**
 * 执行浏览器动作并返回给 LLM 的中文结果字符串。
 * busy 锁在此处统一持有：浏览器界面是共享资源，工具内外调用都经由此入口。
 */
export async function executeBrowserAction(
  params: BrowserActionParams,
  signal?: AbortSignal
): Promise<string> {
  if (busy) {
    return '⏳ 浏览器工具正在执行其他操作（浏览器界面是共享资源），请稍后再试。'
  }
  busy = true
  try {
    if (signal?.aborted) return '⏹ 操作已取消'
    const wc = await ensureBrowserReady()
    if (!wc) {
      return '❌ 无法操作浏览器：右侧浏览器面板未打开，且自动打开失败。请确认应用窗口存在。'
    }
    switch (params.action) {
      case 'navigate':
        return await actionNavigate(params)
      case 'click':
        return await actionClick(params)
      case 'type':
        return await actionType(params)
      case 'scroll':
        return await actionScroll(params)
      case 'back':
        return await actionBackForward(params, 'back')
      case 'forward':
        return await actionBackForward(params, 'forward')
      case 'reload':
        return await actionReload()
      case 'screenshot':
        return await actionScreenshot()
      case 'read':
        return await actionRead()
      case 'wait':
        return await actionWait(params, signal)
      default:
        return `❌ 未知操作: ${params.action}`
    }
  } finally {
    busy = false
  }
}
