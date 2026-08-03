// data_analysis 工具回归测试：node test/data-analysis.test.cjs
// 先 esbuild 打包工具源码，再跑断言（与已知精确数学结果对比）
const { execSync } = require('child_process')
const path = require('path')

const root = path.join(__dirname, '..')
execSync(
  'npx esbuild src/main/agents/tools/data-analysis.tool.ts ' +
    '--bundle --platform=node --format=cjs --outdir=test/.analysis-test --log-level=warning',
  { cwd: root, stdio: 'inherit' }
)

const { dataAnalysisTool } = require('./.analysis-test/data-analysis.tool.js')

let passed = 0
function check(name, cond) {
  if (!cond) throw new Error(`FAILED: ${name}`)
  passed++
  console.log(`  ✓ ${name}`)
}
function near(v, target, tol = 1e-6) {
  return typeof v === 'number' && isFinite(v) && Math.abs(v - target) <= tol * Math.max(1, Math.abs(target))
}
function parseTable(md) {
  const rows = md.split('\n').filter((l) => l.startsWith('|'))
  const result = {}
  for (const row of rows.slice(2)) {
    const cells = row.split('|').slice(1, -1).map((c) => c.trim())
    result[cells[0]] = cells.length > 2 ? cells.slice(1) : cells[1]
  }
  return result
}
function extractNum(s) {
  const m = String(s).replace(/,/g, '').match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/i)
  return m ? parseFloat(m[0]) : NaN
}

async function main() {
  // 1. describe：验证统计量
  const desc = await dataAnalysisTool.invoke({
    operation: 'describe',
    series: [{ name: 'A', values: [2, 4, 4, 4, 5, 5, 7, 9] }]
  })
  const dt = parseTable(desc)
  check('describe: 均值', near(extractNum(dt['均值']), 5))
  check('describe: 中位数', near(extractNum(dt['中位数']), 4.5))
  check('describe: 最小值/最大值', near(extractNum(dt['最小值']), 2) && near(extractNum(dt['最大值']), 9))
  check('describe: 标准差', near(extractNum(dt['标准差']), Math.sqrt(32 / 7), 1e-3)) // 样本方差 32/7

  // 2. 线性回归：精确线性数据 → R²=1
  const x = [1, 2, 3, 4, 5, 6, 7, 8]
  const y = x.map((v) => 2 + 3 * v)
  const lf = await dataAnalysisTool.invoke({ operation: 'linear_fit', x, y })
  check('linear_fit: R²=1', lf.includes('R² = 1'))
  check('linear_fit: 斜率 3', lf.includes('3·x') || /斜率 b \| 3/.test(lf))
  check('linear_fit: 截距 2', lf.includes('2 + 3·x') || /截距 a \| 2/.test(lf))

  // 3. 多项式拟合：y = 1 + 2x + 0.5x²，x 取大数值验证尺度变换
  const xb = [1000, 1002, 1004, 1006, 1008, 1010]
  const yb = xb.map((v) => 1 + 2 * v + 0.5 * v * v)
  const pf = await dataAnalysisTool.invoke({ operation: 'polynomial_fit', x: xb, y: yb, degree: 2 })
  check('polynomial_fit: R²=1', pf.includes('R² = 1'))
  const m2 = pf.match(/0\.5·x\^2|0\.5000000·x\^2|0\.5000·x\^2/)
  check('polynomial_fit: 二次项 0.5', !!m2)

  // 4. 指数拟合：y = 3·e^(0.5x) 精确
  const xe = [0, 1, 2, 3, 4]
  const ye = xe.map((v) => 3 * Math.exp(0.5 * v))
  const ef = await dataAnalysisTool.invoke({ operation: 'exponential_fit', x: xe, y: ye })
  check('exponential_fit: R²=1', ef.includes('R² = 1'))
  check('exponential_fit: a=3', /a \| 3\b|a \| 2\.99/.test(ef))

  // 5. 相关：完全正相关 r=1
  const corr = await dataAnalysisTool.invoke({
    operation: 'correlation',
    series: [
      { name: 'x', values: [1, 2, 3, 4, 5] },
      { name: 'y', values: [3, 6, 9, 12, 15] }
    ]
  })
  check('correlation: Pearson r=1', /Pearson r \| 1/.test(corr))
  check('correlation: Spearman ρ=1', /Spearman ρ \| 1/.test(corr))

  // 6. 单样本 t 检验：数据均值=μ → t=0, p=1
  const t1 = await dataAnalysisTool.invoke({
    operation: 'ttest_onesample',
    series: [{ name: 'A', values: [1, 2, 3, 4, 5] }],
    mu: 3
  })
  check('ttest_onesample: t=0', /t 统计量 \| 0/.test(t1))
  check('ttest_onesample: p≈1', t1.includes('> 0.999999'))

  // 7. 独立 t 检验：两组差异巨大 → p 很小
  const t2 = await dataAnalysisTool.invoke({
    operation: 'ttest_independent',
    series: [
      { name: 'A', values: [1, 2, 3, 4, 5] },
      { name: 'B', values: [21, 22, 23, 24, 25] }
    ]
  })
  check('ttest_independent: 均值差 -20', /均值差 \| -20/.test(t2))
  check('ttest_independent: p 极小', t2.includes('< 1e-6'))

  // 8. 配对 t 检验：恒等对 → t=0
  const t3 = await dataAnalysisTool.invoke({
    operation: 'ttest_paired',
    series: [
      { name: 'A', values: [1, 2, 3, 4, 5] },
      { name: 'B', values: [1, 2, 3, 4, 5] }
    ]
  })
  check('ttest_paired: t=0', /t 统计量 \| 0/.test(t3))

  // 9. 正态性：均匀分布数据应被拒绝（JB 大、p 小）
  let uniform = []
  let seed = 42
  const rand = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  for (let i = 0; i < 200; i++) uniform.push(rand())
  const nt = await dataAnalysisTool.invoke({
    operation: 'normality',
    series: [{ name: 'U', values: uniform }]
  })
  check('normality: 均匀数据被拒绝', nt.includes('拒绝 H₀'))

  // 10. 移动平均
  const ma = await dataAnalysisTool.invoke({
    operation: 'moving_average',
    series: [{ name: 'A', values: [1, 2, 3, 4, 5] }],
    window: 3
  })
  check('moving_average: 输出平滑数组', ma.includes('[1, 1.5, 2, 3, 4]'))

  // 11. 错误处理：长度不一致
  const err = await dataAnalysisTool.invoke({
    operation: 'correlation',
    series: [
      { name: 'x', values: [1, 2, 3] },
      { name: 'y', values: [1, 2] }
    ]
  })
  check('错误: x/y 长度不一致', err.includes('长度不一致'))

  // 12. t 分布 CDF 已知值：P(T_10 ≤ 0) = 0.5（通过 t=0 检验已间接验证）；F 检验在独立 t 检验 p 极小时覆盖
  console.log(`\nALL ${passed} TESTS PASSED`)
}

main().catch((e) => { console.error(e); process.exit(1) })
