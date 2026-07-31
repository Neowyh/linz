// 大端二元分词（CJK bigram + 拉丁/数字整词）验证
function toBigramTokens(text) {
  const tokens = []
  let latin = ''
  let cjkRun = []
  const flushLatin = () => { if (latin) { tokens.push(latin.toLowerCase()); latin = '' } }
  const flushCjk = () => {
    if (cjkRun.length === 1) tokens.push(cjkRun[0])
    else for (let i = 0; i < cjkRun.length - 1; i++) tokens.push(cjkRun[i] + cjkRun[i + 1])
    cjkRun = []
  }
  for (const ch of text) {
    if (/[一-鿿㐀-䶿豈-﫿]/.test(ch)) { flushLatin(); cjkRun.push(ch) }
    else if (/[A-Za-z0-9_.-]/.test(ch)) { flushCjk(); latin += ch }
    else { flushLatin(); flushCjk() }
  }
  flushLatin(); flushCjk()
  return tokens
}

const Database = require('better-sqlite3')
const db = new Database(':memory:')
db.exec("CREATE VIRTUAL TABLE t USING fts5(content, tokenize='unicode61')")
const ins = db.prepare('INSERT INTO t VALUES (?)')
ins.run(toBigramTokens('安保知识库测试文档').join(' '))
ins.run(toBigramTokens('机翼结构设计规范 NACA4412 翼型').join(' '))
console.log('索引内容:', JSON.stringify(toBigramTokens('机翼结构设计规范 NACA4412 翼型')))

function matchQuery(q) {
  const toks = toBigramTokens(q)
  if (toks.length === 0) return null
  return '"' + toks.join('" "') + '"'
}
for (const q of ['安保', '机翼', '知识库', 'NACA4412', 'naca4412', '翼型', '安全', '4412', '结构设计规范']) {
  const m = matchQuery(q)
  try {
    const rows = db.prepare('SELECT content FROM t WHERE t MATCH ?').all(m)
    console.log(JSON.stringify(q), '->', m, '=> 命中', rows.length)
  } catch (e) { console.log(JSON.stringify(q), 'ERR', e.message) }
}
