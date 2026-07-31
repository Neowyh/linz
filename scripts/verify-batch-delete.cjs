// 批量删除端到端验证：IPC 批量删除 + 全选 UI 截图
const WebSocket = require('ws')
const http = require('http')
const fs = require('fs')

const SHOT_PATH = 'E:\\lijx\\plane3d\\Design_Multi-Agent\\win7-verify\\scripts\\verify-batch-delete.png'

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
  async eval(expression, timeoutMs = 60000) {
    const result = await Promise.race([
      this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('eval timeout')), timeoutMs))
    ])
    if (result.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(result.exceptionDetails.exception?.description || result.exceptionDetails.text))
    return result.result.value
  }
  close() { this.ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const targets = await getJson('http://127.0.0.1:9222/json')
  const page = targets.find((t) => t.type === 'page' && t.url.includes('localhost:517'))
  const cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.ready()

  // 1. 批量删除 3 个文档，验证统计精确减少
  const before = await cdp.eval(`window.aeromind.kb.stats()`)
  const victims = await cdp.eval(`window.aeromind.kb.listDocuments().then(d => d.slice(0, 3).map(x => ({ id: x.id, name: x.file_name, chunks: x.chunk_count })))`)
  const expectChunks = victims.reduce((s, v) => s + v.chunks, 0)
  const delResult = await cdp.eval(`window.aeromind.kb.deleteDocuments(${JSON.stringify(victims.map((v) => v.id))})`)
  const after = await cdp.eval(`window.aeromind.kb.stats()`)
  console.log(`批量删除 3 个文档: ${JSON.stringify(delResult)}`)
  console.log(`  文档数 ${before.totalDocuments} → ${after.totalDocuments}（应 -3）`)
  console.log(`  chunks ${before.totalChunks} → ${after.totalChunks}（应 -${expectChunks}）`)

  // 2. 检索一致性：被删文档的内容不应再命中
  const victimName = victims[0].name.replace(/[《》（）()〔〕].*$/g, '').substring(0, 6)
  const hits = await cdp.eval(`window.aeromind.kb.listDocuments().then(d => d.some(x => ${JSON.stringify(victims.map((v) => v.id))}.includes(x.id)))`)
  console.log(`  被删文档仍在列表中: ${hits}（应为 false）`)

  // 3. 异常输入：空数组 / 非数组
  const emptyRes = await cdp.eval(`window.aeromind.kb.deleteDocuments([])`)
  const badRes = await cdp.eval(`window.aeromind.kb.deleteDocuments(null)`)
  console.log(`🔍 空数组 → ${JSON.stringify(emptyRes)}; null → ${JSON.stringify(badRes)}`)

  // 4. UI 截图：勾选前 2 行复选框，展示"删除选中"按钮出现
  await cdp.eval(`location.hash = '#/knowledge'; 'ok'`)
  await sleep(2000)
  await cdp.eval(`(() => { const b = document.querySelectorAll('.ant-checkbox-input'); if (b[1]) b[1].click(); return 'clicked' })()`)
  await sleep(600)
  await cdp.eval(`(() => { const b = document.querySelectorAll('.ant-checkbox-input'); if (b[2]) b[2].click(); return 'clicked' })()`)
  await sleep(600)
  const btnText = await cdp.eval(`Array.from(document.querySelectorAll('button')).map(b => b.textContent).find(t => t.includes('删除选中')) || null`)
  const headerCheck = await cdp.eval(`document.querySelector('.ant-checkbox-indeterminate') !== null || document.querySelector('.ant-checkbox-checked') !== null`)
  console.log(`  UI: "删除选中"按钮文本 = ${JSON.stringify(btnText)}; 复选框勾选状态 = ${headerCheck}`)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(SHOT_PATH, Buffer.from(shot.data, 'base64'))
  console.log('  截图已保存:', SHOT_PATH)

  cdp.close()
  process.exit(0)
}

main().catch((err) => { console.error('VERIFY FAILED:', err.message); process.exit(1) })
