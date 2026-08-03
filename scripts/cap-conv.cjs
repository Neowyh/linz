const WebSocket = require('ws'); const http = require('http'); const fs = require('fs'); const path = require('path')
const OUT = path.join(__dirname, 'shots')
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
  const ev=async(e)=>{const r=await send('Runtime.evaluate',{expression:e,awaitPromise:true,returnByValue:true}); if(r.result?.exceptionDetails) console.log('EXC', JSON.stringify(r.result.exceptionDetails).slice(0,300)); return r.result?.result?.value}
  const shot=async(name)=>{await send('Page.bringToFront'); await sleep(300); const r=await send('Page.captureScreenshot',{format:'png'}); fs.writeFileSync(path.join(OUT,name+'.png'), Buffer.from(r.result.data,'base64')); console.log('✓',name)}
  const convs = [
    ['conv-waverider', 'cbc7c268-d271-4935-acd1-cecb0ae1d2b1'],  // 乘波体设计
    ['conv-catia', '5d0f65e1-720b-46ac-820a-0069f7d8b00e'],        // 启动catia
    ['conv-table-chart', '17f36a69-4e17-4553-9dda-df307955a15e'],  // 屈曲值可视化
    ['conv-naca-coupling', 'c6ab4220-051a-471b-b02b-6cdc1569cd41'] // NACA 气动结构耦合
  ]
  for (const [name, cid] of convs) {
    await ev(`location.hash = '#/chat/${cid}'; 'ok'`); await sleep(3000)
    await shot(name)
  }
  ws.close(); process.exit(0)
}
main().catch(e=>{console.error('FAIL',e.message);process.exit(1)})
