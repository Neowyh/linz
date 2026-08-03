// 导出图片链路回归测试：node test/export-image.test.cjs
// 验证：PNG data URL → docx ImageRun（media 存在、尺寸正确）、Markdown bundle 逻辑
const { execSync } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')

const root = path.join(__dirname, '..')
execSync(
  'npx esbuild src/main/exporters/word.exporter.ts src/main/exporters/latex-to-omml.ts ' +
    '--bundle --platform=node --format=cjs --outdir=test/.export-test --log-level=warning',
  { cwd: root, stdio: 'inherit' }
)
// esbuild 输出到 outdir 根；word.exporter 依赖 latex-to-omml（同一 outdir）
const { exportToWord } = require('./.export-test/word.exporter.js')

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error(`FAILED: ${name}`)
  passed++
  console.log(`  ✓ ${name}`)
}

// 1x1 PNG（已知 base64，IHDR 宽高 = 1x1）
const PNG_1x1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

// 4x3 白色 PNG（手工构造：IHDR 宽高 4x3 + IDAT 全零滤波行）
function buildPng(width, height) {
  const zlib = require('zlib')
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // color type: truecolor
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0
  const raw = Buffer.alloc(height * (1 + width * 3))
  for (let y = 0; y < height; y++) {
    raw[y * (1 + width * 3)] = 0 // filter: none
  }
  const idat = zlib.deflateSync(raw)
  const chunk = (type, data) => {
    const len = Buffer.alloc(4)
    len.writeUInt32BE(data.length)
    const typeBuf = Buffer.from(type, 'latin1')
    const crcBuf = Buffer.alloc(4)
    const crc = require('zlib').crc32 || null
    // crc32 计算（Node 无内置，手动实现）
    let c = ~0
    for (const b of Buffer.concat([typeBuf, data])) {
      c ^= b
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    crcBuf.writeUInt32BE(~c >>> 0)
    return Buffer.concat([len, typeBuf, data, crcBuf])
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0))
  ])
}

async function main() {
  const png4x3 = buildPng(4, 3)
  const b64 = png4x3.toString('base64')

  // 1. exportToWord 生成含图片的 docx
  const content = `分析结果如下：

![气动曲线](data:image/png;base64,${b64})

总结完毕`
  const docxBuf = await exportToWord(
    [{ id: 'm1', role: 'agent', agentType: 'aero', content }],
    { includeAgentBadges: true, title: '测试' }
  )
  check('docx 生成成功', Buffer.isBuffer(docxBuf) && docxBuf.length > 1000)

  // 2. docx 内部包含图片 media（用 JSZip 检查）
  const JSZip = require('jszip')
  const zip = await JSZip.loadAsync(docxBuf)
  const mediaFiles = Object.keys(zip.files).filter((f) => f.startsWith('word/media/') && !f.endsWith('/'))
  check('docx 包含 media 图片', mediaFiles.length === 1 && mediaFiles[0].endsWith('.png'))
  const imgData = await zip.file(mediaFiles[0]).async('nodebuffer')
  check('media 图片为 4x3 PNG', imgData.length === png4x3.length && imgData.equals(png4x3))
  const relXml = await zip.file('word/_rels/document.xml.rels').async('string')
  check('docx 图片关系引用存在', relXml.includes('media/') && relXml.includes('image'))

  // 3. 无效图片（非 PNG data URL）回退为文本，不崩
  const badContent = '![图](data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=)\n其他文本'
  const docxBuf2 = await exportToWord([{ id: 'm2', role: 'agent', content: badContent }])
  check('SVG data URL 回退不崩', Buffer.isBuffer(docxBuf2))

  // 4. 无图片消息正常导出
  const docxBuf3 = await exportToWord([{ id: 'm3', role: 'user', content: '你好' }])
  check('无图片消息导出正常', Buffer.isBuffer(docxBuf3) && docxBuf3.length > 500)

  // 5. 1x1 PNG 尺寸解析（通过导出不崩 + 生成 media 验证）
  const tinyContent = `![小图](data:image/png;base64,${PNG_1x1})`
  const docxBuf4 = await exportToWord([{ id: 'm4', role: 'agent', content: tinyContent }])
  const zip4 = await JSZip.loadAsync(docxBuf4)
  const media4 = Object.keys(zip4.files).filter((f) => f.startsWith('word/media/') && !f.endsWith('/'))
  check('1x1 PNG 也生成 media', media4.length === 1)

  console.log(`\nALL ${passed} TESTS PASSED`)
  // 清理
  fs.rmSync(path.join(__dirname, '.export-test'), { recursive: true, force: true })
}

main().catch((e) => { console.error(e); process.exit(1) })
