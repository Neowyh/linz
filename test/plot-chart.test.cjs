// plot_chart 工具回归测试：node test/plot-chart.test.cjs
// 先 esbuild 打包工具源码（含 image-protocol），再跑断言
const { execSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
execSync(
  'npx esbuild src/main/agents/tools/plot-chart.tool.ts src/main/llm/image-protocol.ts ' +
    '--bundle --platform=node --format=cjs --outdir=test/.plot-test --log-level=warning',
  { cwd: root, stdio: 'inherit' }
)

const { plotChartTool } = require('./.plot-test/agents/tools/plot-chart.tool.js')
const { extractImageBlocks } = require('./.plot-test/llm/image-protocol.js')

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error(`FAILED: ${name}`)
  passed++
  console.log(`  ✓ ${name}`)
}

async function main() {
  // 1. 折线图（多系列 + 数值 x 轴）
  const line = await plotChartTool.invoke({
    chartType: 'line',
    title: '升力系数随迎角变化',
    xLabel: '迎角 (deg)',
    yLabel: '升力系数 Cl',
    xValues: [-4, -2, 0, 2, 4, 6, 8, 10, 12, 14],
    series: [
      { name: '优化前', data: [-0.28, -0.12, 0.05, 0.22, 0.38, 0.55, 0.71, 0.86, 0.99, 1.05] },
      { name: '优化后', data: [-0.32, -0.14, 0.06, 0.26, 0.45, 0.63, 0.81, 0.98, 1.13, 1.22] }
    ]
  })
  const l = extractImageBlocks(line)
  check('折线图: 返回含图片块', l.images.length === 1)
  check('折线图: LLM 侧文本剥离图片块', !l.cleanText.includes('<<<IMAGE>>>') && l.cleanText.includes('已生成折线图'))
  check('折线图: data URL 前缀正确', l.images[0].startsWith('data:image/svg+xml;base64,'))

  // 2. 柱状图（分类）
  const bar = await plotChartTool.invoke({
    chartType: 'bar',
    title: '不同翼型最大升阻比对比',
    xCategories: ['NACA0012', 'NACA2412', 'NACA4415', 'NLF1015', 'RAF6'],
    series: [{ name: '最大升阻比', data: [62.3, 78.5, 85.1, 92.4, 70.8] }]
  })
  check('柱状图: 生成图片', extractImageBlocks(bar).images.length === 1)

  // 3. 饼图
  const pie = await plotChartTool.invoke({
    chartType: 'pie',
    title: '机体重量分布',
    xCategories: ['机身', '机翼', '尾翼', '动力', '航电', '起落架'],
    series: [{ name: '重量占比', data: [28, 34, 8, 16, 6, 8] }]
  })
  const p = extractImageBlocks(pie)
  check('饼图: 生成图片', p.images.length === 1)

  // 4. 错误处理：数据长度不一致
  const err = await plotChartTool.invoke({
    chartType: 'bar',
    title: 'x',
    series: [{ name: 'a', data: [1, 2] }, { name: 'b', data: [1] }]
  })
  const e = extractImageBlocks(err)
  check('错误: 返回错误文本', e.cleanText.includes('数据长度'))
  check('错误: 不含图片块', e.images.length === 0)

  // 5. SVG 完整性 + 协议不泄漏
  const svg = Buffer.from(p.images[0].split('base64,')[1], 'base64').toString('utf8')
  check('SVG 结构完整', svg.startsWith('<svg') && svg.endsWith('</svg>'))
  check('SVG 无协议标记泄漏', !svg.includes('<<<IMAGE>>>'))
  check('SVG 含中文标题', svg.includes('机体重量分布'))

  console.log(`\nALL ${passed} TESTS PASSED`)
}

main().catch((e) => { console.error(e); process.exit(1) })
