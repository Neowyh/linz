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
  /** 元素编号：由 getInteractiveElements 返回，click/type/wait/scroll 可用它定位元素（推荐，比手写 selector 准） */
  ref?: number
}

const HTTP_RE = /^https?:\/\//i
const MAX_READ_CHARS = 8000 // read 正文截断（配合 stream-handler 的 MAX_TOOL_OUTPUT=10000）
const POLL_INTERVAL_MS = 250
const RID_ATTR = 'data-linz-rid' // 元素编号属性名，getInteractiveElements 写入，click/type/wait/scroll 按 ref 读取
const INTERACTIVE_MAX = 50 // 单次列出的元素上限，防返回超 MAX_TOOL_OUTPUT 被截断

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

/**
 * 解析"目标元素"定位串：优先用 ref 编号（转 [data-linz-rid="N"]），其次 selector。
 * 返回 string=可用的选择器表达式；返回 {err}=两者都无或 ref 非法（调用方直接返回 err 给 LLM）。
 * ref 优先：getInteractiveElements 返回的编号比手写 selector 更准，鼓励模型用编号。
 */
function resolveTargetExpr(p: BrowserActionParams): string | { err: string } {
  if (typeof p.ref === 'number' && Number.isFinite(p.ref) && p.ref > 0) {
    return ridSelectorExpr(p.ref)
  }
  const selector = (p.selector || '').trim()
  if (selector) return selector
  return {
    err: '❌ 需要提供 ref（getInteractiveElements 返回的编号，推荐）或 selector 参数来定位元素'
  }
}

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
// selectorExpr：定位元素的选择器串——ref 编号时为 [data-linz-rid="N"]，手写 selector 时为原值
function clickSnippet(selectorExpr: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selectorExpr)})
  if (!el) return { ok: false, error: '未找到匹配元素: ' + ${JSON.stringify(selectorExpr)} + '（若用的是 ref 编号，页面可能已刷新/导航，请重新 getInteractiveElements）' }
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
  const expr = resolveTargetExpr(p)
  if (typeof expr !== 'string') return expr.err
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    const result = (await runInPage(wc, clickSnippet(expr))) as { ok: boolean; error?: string; tag?: string; text?: string }
    if (!result?.ok) return `❌ 点击失败: ${result?.error || '未知错误'}`
    const text = result.text ? `（"${result.text}"）` : ''
    return `✅ 已点击 <${result.tag}>${text}`
  } catch (err: any) {
    return `❌ 点击失败: ${err?.message || String(err)}`
  }
}

// 原生 value setter + input/change 事件（React 受控输入框兼容）
// selectorExpr：ref 编号时为 [data-linz-rid="N"]，手写 selector 时为原值
function typeSnippet(selectorExpr: string, text: string): string {
  return `(() => {
  const el = document.querySelector(${JSON.stringify(selectorExpr)})
  if (!el) return { ok: false, error: '未找到匹配元素: ' + ${JSON.stringify(selectorExpr)} + '（若用的是 ref 编号，页面可能已刷新/导航，请重新 getInteractiveElements）' }
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
  const expr = resolveTargetExpr(p)
  if (typeof expr !== 'string') return expr.err
  const text = p.text ?? ''
  if (!text) return '❌ type 需要提供 text 参数（要输入的文本）'
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    const result = (await runInPage(wc, typeSnippet(expr, text))) as { ok: boolean; error?: string; tag?: string }
    if (!result?.ok) return `❌ 输入失败: ${result?.error || '未知错误'}`
    return `✅ 已在 <${result.tag}> 输入文本（${text.length} 字符）`
  } catch (err: any) {
    return `❌ 输入失败: ${err?.message || String(err)}`
  }
}

// selectorExpr：ref 编号时为 [data-linz-rid="N"]，手写 selector 时为原值；两者都无则按 deltaY 滚窗
function scrollSnippet(selectorExpr?: string, deltaY?: number): string {
  if (selectorExpr) {
    return `(() => {
  const el = document.querySelector(${JSON.stringify(selectorExpr)})
  if (!el) return { ok: false, error: '未找到匹配元素: ' + ${JSON.stringify(selectorExpr)} + '（若用的是 ref 编号，页面可能已刷新/导航，请重新 getInteractiveElements）' }
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
  const expr = resolveTargetExpr(p) // 两者都无时为 { err }（ok：按 deltaY 滚窗），或 selectorExpr
  const selectorExpr = typeof expr === 'string' ? expr : undefined
  try {
    const result = (await runInPage(wc, scrollSnippet(selectorExpr, p.deltaY))) as { ok: boolean; error?: string; mode?: string; y?: number }
    if (!result?.ok) return `❌ 滚动失败: ${result?.error || '未知错误'}`
    return result.mode === 'selector'
      ? `✅ 已滚动到元素 ${selectorExpr}（页面纵向位置 ${result.y}px）`
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

// 按 ref 编号定位元素的查询串（DOM 选择器形式，可嵌入任意 snippet 用 querySelector）
function ridSelectorExpr(ref: number): string {
  // [data-linz-rid="N"]，N 经 JSON.stringify 嵌入防注入
  return `[${RID_ATTR}=${JSON.stringify(String(ref))}]`
}

// getInteractiveElements：遍历当前页面可交互元素，按可视顺序编号写入 data-linz-rid，
// 返回 { rid, hint } 清单。hint 是给人/小模型读的简短定位语。
// 限可视区 + 上限 INTERACTIVE_MAX 个，防返回超 MAX_TOOL_OUTPUT 被截断。
// 每次调用都重新编号、覆盖旧 data-linz-rid（页面刷新/导航后旧编号作废，必须重拉）。
function getInteractiveElementsSnippet(): string {
  return `(() => {
  const SEL = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [role="checkbox"], [role="tab"], [onclick], summary, [contenteditable="true"]'
  const vw = window.innerWidth, vh = window.innerHeight
  const inViewport = (r) => r.width > 0 && r.height > 0 && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
  const all = Array.from(document.querySelectorAll(SEL))
  // 清掉上次的编号（避免残留指向已移除元素）
  for (const e of all) e.removeAttribute('${RID_ATTR}')
  const visible = []
  for (const e of all) {
    const cs = getComputedStyle(e)
    if (cs.display === 'none' || cs.visibility === 'hidden' || e.getAttribute('aria-hidden') === 'true') continue
    const r = e.getBoundingClientRect()
    if (!inViewport(r)) continue
    visible.push({ e, r, area: r.width * r.height })
  }
  // 面积大的排前面（更可能是主要按钮），稳定排序
  visible.sort((a, b) => b.area - a.area || a.r.top - b.r.top)
  const take = visible.slice(0, ${INTERACTIVE_MAX})
  const items = []
  for (let i = 0; i < take.length; i++) {
    const e = take[i].e
    const n = i + 1
    e.setAttribute('${RID_ATTR}', String(n))
    const tag = e.tagName.toLowerCase()
    const role = e.getAttribute('role') || ''
    const text = ((e.innerText || e.textContent || e.value || e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('alt') || e.getAttribute('placeholder') || '').trim()).slice(0, 40)
    const href = tag === 'a' ? (e.getAttribute('href') || '').slice(0, 50) : ''
    const type = e.getAttribute('type') || ''
    const name = e.getAttribute('name') || ''
    const ph = e.getAttribute('placeholder') || ''
    // hint：简短可读定位语
    let hint = '<' + tag
    if (role) hint += ' role=' + role
    if (type) hint += ' type=' + type
    if (name) hint += ' name=' + name
    if (ph) hint += ' placeholder=' + JSON.stringify(ph).slice(1, -1)
    if (href && href !== '#') hint += ' -> ' + href
    hint += '>'
    if (text) hint += ' ' + JSON.stringify(text).slice(1, -1)
    items.push({ rid: n, hint })
  }
  const lines = items.map((it) => '[' + it.rid + '] ' + it.hint).join('\\n')
  return { count: items.length, truncated: visible.length > take.length, text: lines }
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

// 列出当前页面可交互元素并打编号：让小模型"按编号操作"而非"盲猜 selector"。
// 编号是快照，页面刷新/导航后 data-linz-rid 失效，必须重新调用本动作刷新。
async function actionGetInteractiveElements(): Promise<string> {
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  try {
    const r = (await runInPage(wc, getInteractiveElementsSnippet())) as { count?: number; truncated?: boolean; text?: string }
    if (!r) return '❌ 获取元素失败：页面尚未就绪'
    if (!r.count) return 'ℹ️ 当前页面无可交互元素（可能还在加载，稍后重试或先 wait 等待元素出现）。'
    const trunc = r.truncated ? `\n（仅列出可视区前 ${INTERACTIVE_MAX} 个，需更多请 scroll 后重新 getInteractiveElements）` : ''
    return `🧭 当前页面可交互元素清单（按编号操作，例如 click({ ref: 3 })/type({ ref: 3, text: '...' })）：\n${r.text || '（无）'}${trunc}`
  } catch (err: any) {
    return `❌ 获取元素失败: ${err?.message || String(err)}`
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
  // 支持 ref 编号（推荐）或手写 selector
  let expr: string
  if (typeof p.ref === 'number' && Number.isFinite(p.ref) && p.ref > 0) {
    expr = ridSelectorExpr(p.ref)
  } else {
    const selector = (p.selector || '').trim()
    if (!selector) return '❌ wait 需要提供 ref（getInteractiveElements 返回的编号，推荐）或 selector 参数'
    expr = selector
  }
  const timeoutMs = Math.min(Math.max(p.timeoutMs ?? 10_000, 1_000), 30_000)
  const wc = getActiveBrowserWebContents()
  if (!wc) return '❌ 浏览器不可用'
  const deadline = Date.now() + timeoutMs
  const check = `!!document.querySelector(${JSON.stringify(expr)})`
  while (Date.now() < deadline) {
    if (signal?.aborted) return '⏹ 操作已取消'
    try {
      const found = await runInPage(wc, check)
      if (found) return `✅ 元素已出现: ${expr}`
    } catch (err: any) {
      // 页面导航中/guest 销毁 → 继续等待（除非明确不可恢复）
      if (wc.isDestroyed()) return `❌ 等待失败: ${err?.message || String(err)}`
    }
    await sleep(POLL_INTERVAL_MS)
  }
  return `⏱ 等待超时：${timeoutMs}ms 内未找到元素 ${expr}（若用的是 ref 编号，页面可能已刷新/导航，请重新 getInteractiveElements）`
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
      case 'getInteractiveElements':
        return await actionGetInteractiveElements()
      case 'wait':
        return await actionWait(params, signal)
      default:
        return `❌ 未知操作: ${params.action}`
    }
  } finally {
    busy = false
  }
}
