// 批量截取临智 LINZ 各页面：导航 hash 路由 + CDP 截图
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')
const path = require('path')

const OUT_DIR = path.join(__dirname, 'shots')
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
    }).on('error', reject)
  })
}

class Cdp {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl, { maxPayload: 512 * 1024 * 1024 })
    this.nextId = 1
    this.pending = new Map()
    this.ws.on('message', (raw) => {
      const msg = JSON.parse(raw.toString())
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message))
        else resolve(msg.result)
      }
    })
  }
  ready() { return new Promise((res, rej) => { this.ws.on('open', res); this.ws.on('error', rej) }) }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  async eval(expression, timeoutMs = 30000) {
    const result = await Promise.race([
      this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('eval timeout')), timeoutMs))
    ])
    if (result.exceptionDetails) throw new Error('页面异常: ' + (result.exceptionDetails.exception?.description || result.exceptionDetails.text))
    return result.result.value
  }
  async shot(name) {
    const r = await this.send('Page.captureScreenshot', { format: 'png' })
    fs.writeFileSync(path.join(OUT_DIR, name + '.png'), Buffer.from(r.data, 'base64'))
    console.log('  ✓', name)
  }
  close() { this.ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const pages = [
  ['chat', '/chat', 2500],
  ['auto-tasks', '/auto-tasks', 2000],
  ['templates', '/templates', 2000],
  ['agents', '/agents', 2500],
  ['knowledge', '/knowledge', 2500],
  ['office', '/office', 3500]
]

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json')
  const page = targets.find((t) => t.type === 'page')
  if (!page) throw new Error('未找到页面')
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.ready()
  await cdp.send('Page.enable')
  console.log('== 已连接:', page.url)

  const only = process.argv[2]
  for (const [name, route, wait] of pages) {
    if (only && name !== only) continue
    await cdp.eval(`location.hash = '#${route}'; 'ok'`)
    await sleep(wait)
    await cdp.shot(name)
  }

  cdp.close()
  process.exit(0)
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
