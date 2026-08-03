// 截取交互式页面：设置弹窗、Agents 各 Tab、Agent 编辑器
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')
const OUT_DIR = path.join(__dirname, 'shots')

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => { try { resolve(JSON.parse(d)) } catch (e) { reject(e) } }) }).on('error', reject)
  })
}
class Cdp {
  constructor(wsUrl) { this.ws = new WebSocket(wsUrl, { maxPayload: 512 * 1024 * 1024 }); this.nextId = 1; this.pending = new Map()
    this.ws.on('message', (raw) => { const m = JSON.parse(raw.toString()); if (m.id && this.pending.has(m.id)) { const { resolve, reject } = this.pending.get(m.id); this.pending.delete(m.id); m.error ? reject(new Error(m.error.message)) : resolve(m.result) } }) }
  ready() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej) }) }
  send(method, params = {}) { const id = this.nextId++; return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.ws.send(JSON.stringify({ id, method, params })) }) }
  async eval(expression, timeoutMs = 30000) {
    const r = await Promise.race([this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }), new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), timeoutMs))])
    if (r.exceptionDetails) throw new Error('页面异常: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text))
    return r.result.value
  }
  async shot(name) { const r = await this.send('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(r.data, 'base64')); console.log('  ✓', name) }
  close() { this.ws.close() }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// 点击包含指定文本的元素
const clickByText = (text, tag = '*') => `(() => {
  const els = [...document.querySelectorAll('${tag}')]
  const el = els.find(e => e.textContent.trim() === '${text}' && e.offsetParent !== null)
  if (el) { el.click(); return 'clicked:${text}' }
  const el2 = els.find(e => e.textContent.includes('${text}') && e.offsetParent !== null)
  if (el2) { el2.click(); return 'clicked~:${text}' }
  return 'notfound:${text}'
})()`

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json')
  const page = targets.find((t) => t.type === 'page')
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.ready(); await cdp.send('Page.enable')
  console.log('== 已连接')

  // 1. Agents 页面 - MCP 服务器 Tab
  await cdp.eval(`location.hash = '#/agents'; 'ok'`); await sleep(2000)
  console.log(await cdp.eval(clickByText('MCP 服务器'))); await sleep(1800)
  await cdp.shot('agents-mcp')

  // 2. 工具总览 Tab
  console.log(await cdp.eval(clickByText('工具总览'))); await sleep(1800)
  await cdp.shot('agents-tools')

  // 3. 技能 Tab
  console.log(await cdp.eval(clickByText('技能'))); await sleep(1800)
  await cdp.shot('agents-skills')

  // 4. Agent 列表 Tab，点编辑进入编辑器
  console.log(await cdp.eval(clickByText('Agent 列表'))); await sleep(1200)
  // 点击第一个编辑图标（title=编辑 或 .anticon-edit）
  console.log(await cdp.eval(`(() => { const b = document.querySelector('.anticon-edit'); if (b) { b.closest('button,span').click(); return 'edit clicked' } return 'no edit' })()`))
  await sleep(2000)
  await cdp.shot('agent-editor')
  await cdp.eval(`location.hash = '#/agents'; 'ok'`); await sleep(1000)

  // 5. 设置弹窗
  console.log(await cdp.eval(clickByText('设置', 'button'))); await sleep(1800)
  await cdp.shot('settings')
  // 关闭弹窗
  await cdp.eval(`(() => { const b = document.querySelector('.ant-modal-close'); if (b) { b.click(); return 'closed' } return 'no modal' })()`)
  await sleep(500)

  cdp.close(); process.exit(0)
}
main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
