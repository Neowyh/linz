// 裸 CDP WebSocket 客户端：驱动 Electron 渲染进程验证知识库改造
// （playwright connectOverCDP 在 Electron 22 上不兼容，改用页面级 CDP 直连）
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')

const KB_FOLDER = 'E:\\lijx\\plane3d\\Design_Multi-Agent\\安保知识库'
const SHOT_PATH = 'E:\\lijx\\plane3d\\Design_Multi-Agent\\win7-verify\\scripts\\verify-kb-page.png'

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => {
        try { resolve(JSON.parse(data)) } catch (e) { reject(e) }
      })
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
  ready() {
    return new Promise((resolve, reject) => {
      this.ws.on('open', resolve)
      this.ws.on('error', reject)
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  // 在页面上下文执行表达式（awaitPromise 支持异步），超时 ms
  async eval(expression, timeoutMs = 30000) {
    const result = await Promise.race([
      this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error(`eval timeout: ${expression.substring(0, 60)}`)), timeoutMs))
    ])
    if (result.exceptionDetails) {
      throw new Error('页面内执行异常: ' + JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails.text))
    }
    return result.result.value
  }
  close() { this.ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:5173'))
  if (!page) throw new Error('未找到渲染进程页面')
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.ready()
  console.log('== 已连接页面:', page.url)

  // 1. 导航到知识库页面
  await cdp.eval(`location.hash = '#/knowledge'; 'ok'`)
  await sleep(1500)
  const header = await cdp.eval(`document.querySelector('h2')?.textContent`)
  console.log('== 知识库页面标题:', header)

  // 2. 挂进度钩子并发起导入
  await cdp.eval(`
    window.__kbEvents = [];
    window.__kbDone = null;
    window.aeromind.kb.onImportProgress((e) => window.__kbEvents.push(e));
    window.aeromind.kb.importPaths(${JSON.stringify([KB_FOLDER])}, ['安保']).then((s) => { window.__kbDone = s });
    'started'
  `)
  console.log('== 导入已开始（54MB / 285 文件，标签"安保"），轮询等待...')

  const t0 = Date.now()
  let done = false
  let lastReport = 0
  while (Date.now() - t0 < 600000) {
    await sleep(3000)
    const state = await cdp.eval(`({ done: window.__kbDone, events: window.__kbEvents.length, last: window.__kbEvents[window.__kbEvents.length-1] })`)
    if (state.events !== lastReport) {
      lastReport = state.events
      process.stdout.write(`\r   进度事件 ${state.events} 条，最新: ${state.last ? state.last.fileName + ' [' + state.last.status + '] ' + state.last.done + '/' + state.last.total : '-'}`)
    }
    if (state.done) { done = true; break }
  }
  console.log('')
  if (!done) throw new Error('导入超时（10 分钟）')
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const summary = await cdp.eval(`window.__kbDone`)
  console.log(`== 导入完成，耗时 ${elapsed}s: total=${summary.total} done=${summary.done} skipped=${summary.skipped} error=${summary.error}`)
  const errSamples = summary.results.filter((r) => r.status === 'error').slice(0, 8)
  if (errSamples.length > 0) console.log('== 失败样本:', JSON.stringify(errSamples))

  // 3. 库统计
  const stats = await cdp.eval(`window.aeromind.kb.stats()`)
  console.log('== 库统计:', JSON.stringify(stats))

  // 4. 中文关键词搜索计时
  for (const q of ['安保', '安全', '安全生产', '应急', '消防', 'NACA']) {
    const r = await cdp.eval(`(async () => {
      const t = performance.now();
      const res = await window.aeromind.kb.search(${JSON.stringify(q)}, 10);
      return { ms: Math.round(performance.now() - t), count: res.length, firstFile: res[0] && res[0].file_name, firstScore: res[0] && res[0].score };
    })()`)
    console.log(`== 搜索 "${q}": ${r.count} 条, ${r.ms}ms, 首个命中: ${r.firstFile || '-'} score=${r.firstScore != null ? r.firstScore.toFixed(2) : '-'}`)
  }

  // 5. 标签过滤
  const tagHit = await cdp.eval(`window.aeromind.kb.search('安全', 10, ['安保']).then((r) => r.length)`)
  const tagMiss = await cdp.eval(`window.aeromind.kb.search('安全', 10, ['不存在的标签']).then((r) => r.length)`)
  console.log(`== 标签过滤: ["安保"] → ${tagHit} 条; ["不存在的标签"] → ${tagMiss} 条`)

  // 6. 标签列表
  const tags = await cdp.eval(`window.aeromind.kb.tags()`)
  console.log('== 全部标签:', JSON.stringify(tags))

  // 7. 刷新页面截图
  await cdp.eval(`location.reload(); 'ok'`)
  await sleep(4000)
  await cdp.eval(`location.hash = '#/knowledge'; 'ok'`)
  await sleep(2000)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(SHOT_PATH, Buffer.from(shot.data, 'base64'))
  console.log('== 截图已保存:', SHOT_PATH)

  cdp.close()
  process.exit(0)
}

main().catch((err) => {
  console.error('\nVERIFY FAILED:', err.message)
  process.exit(1)
})
