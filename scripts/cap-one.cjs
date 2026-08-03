const WebSocket = require('ws'); const http = require('http'); const fs = require('fs'); const path = require('path')
function getJson(u){return new Promise((res,rej)=>{http.get(u,(r)=>{let d='';r.on('data',c=>d+=c);r.on('end',()=>{try{res(JSON.parse(d))}catch(e){rej(e)}})}).on('error',rej)})}
const sleep=(ms)=>new Promise(r=>setTimeout(r,ms))
async function main(){
  const t = await getJson('http://127.0.0.1:9222/json'); const p = t.find(x=>x.type==='page')
  const ws = new WebSocket(p.webSocketDebuggerUrl,{maxPayload:512*1024*1024})
  let id=0; const pend=new Map()
  ws.on('message',(raw)=>{const m=JSON.parse(raw.toString()); if(m.id&&pend.has(m.id)){pend.get(m.id)(m); pend.delete(m.id)}})
  const send=(method,params={})=>new Promise((res,rej)=>{const i=++id; pend.set(i,res); ws.send(JSON.stringify({id:i,method,params})); setTimeout(()=>rej(new Error('timeout '+method)),25000)})
  await new Promise(r=>ws.on('open',r))
  await send('Page.enable')
  await send('Page.bringToFront'); await sleep(800)
  const name = process.argv[2] || 'shot'
  const r = await send('Page.captureScreenshot',{format:'png'})
  fs.writeFileSync(path.join(__dirname,'shots',name+'.png'), Buffer.from(r.result.data,'base64')); console.log('✓', name)
  ws.close(); process.exit(0)
}
main().catch(e=>{console.error('FAIL',e.message);process.exit(1)})
