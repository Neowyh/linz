const http = require('http')

function getTargets() {
  return new Promise((resolve, reject) => {
    http.get('http://127.0.0.1:9222/json/list', (res) => {
      let data = ''
      res.on('data', (c) => (data += c))
      res.on('end', () => resolve(JSON.parse(data)))
    }).on('error', reject)
  })
}

async function main() {
  const targets = await getTargets()
  const filter = process.argv[3] || 'page'
  const page = targets.find((t) => t.type === filter) || targets.find((t) => t.type === 'page')
  if (!page) { console.error('NO_TARGET'); return }
  const { default: WebSocket } = await import('ws')
  const ws = new WebSocket(page.webSocketDebuggerUrl)
  let id = 0
  const pending = new Map()
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
  })
  const send = (method, params = {}) => new Promise((resolve) => {
    const mid = ++id
    pending.set(mid, resolve)
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  await new Promise((r) => ws.on('open', r))

  const expr = process.argv[2]
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true })
  console.log(JSON.stringify(r.result?.result?.value ?? r.result, null, 2))
  ws.close()
}

main().catch((e) => { console.error('ERR', e); process.exit(1) })
