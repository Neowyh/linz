import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'

// data_analysis：纯 JS 实现的 scipy 风格统计分析工具（零外部依赖，Win7 兼容）。
// 覆盖：描述统计、相关性（Pearson/Spearman）、回归拟合（线性/多项式/指数）、
// t 检验（单样本/独立/配对）、正态性检验（Jarque-Bera）、移动平均平滑。
// 与 plot_chart 配合：先分析数据，再画图展示。

// ============ 基础统计 ============

function mean(x: number[]): number {
  return x.reduce((a, b) => a + b, 0) / x.length
}

// Welford 在线算法（数值稳定）
function variance(x: number[], sample = true): number {
  let m = 0
  let s = 0
  for (let i = 0; i < x.length; i++) {
    const d = x[i] - m
    m += d / (i + 1)
    s += d * (x[i] - m)
  }
  return s / (sample ? x.length - 1 : x.length)
}

function std(x: number[], sample = true): number {
  return Math.sqrt(variance(x, sample))
}

function skewness(x: number[]): number {
  const m = mean(x)
  const s = std(x)
  const n = x.length
  if (s === 0) return 0
  const s3 = x.reduce((a, v) => a + Math.pow((v - m) / s, 3), 0)
  return (n / ((n - 1) * (n - 2))) * s3
}

function kurtosis(x: number[]): number {
  const m = mean(x)
  const s = std(x)
  const n = x.length
  if (s === 0) return 0
  const s4 = x.reduce((a, v) => a + Math.pow((v - m) / s, 4), 0)
  // 样本超额峰度（正态分布 = 0）
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * s4 - (3 * (n - 1) * (n - 1)) / ((n - 2) * (n - 3))
}

// R type-7 分位数（线性插值）
function quantile(sortedX: number[], q: number): number {
  if (sortedX.length === 1) return sortedX[0]
  const h = (sortedX.length - 1) * q
  const lo = Math.floor(h)
  const hi = Math.ceil(h)
  if (lo === hi) return sortedX[lo]
  return sortedX[lo] + (h - lo) * (sortedX[hi] - sortedX[lo])
}

// ============ 分布函数 ============

function gammaLn(x: number): number {
  // Lanczos 近似（数值配方）
  const cof = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5]
  let y = x
  let tmp = x + 5.5
  tmp -= (x + 0.5) * Math.log(tmp)
  let ser = 1.000000000190015
  for (let j = 0; j < 6; j++) {
    y += 1
    ser += cof[j] / y
  }
  return -tmp + Math.log(2.5066282746310005 * ser / x)
}

// 正则化不完全 gamma P(a, x)
function gammaP(a: number, x: number): number {
  if (x <= 0) return 0
  if (x < a + 1) {
    // 级数展开
    let sum = 1 / a
    let term = 1 / a
    for (let n = 1; n < 200; n++) {
      term *= x / (a + n)
      sum += term
      if (Math.abs(term) < Math.abs(sum) * 1e-14) break
    }
    return sum * Math.exp(-x + a * Math.log(x) - gammaLn(a))
  }
  // 连分数
  let bv = x + 1 - a
  let c = 1 / 1e-300
  let d = 1 / bv
  let h = d
  for (let i = 1; i < 200; i++) {
    const an = -i * (i - a)
    bv += 2
    d = an * d + bv
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = bv + an / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-14) break
  }
  return 1 - Math.exp(-x + a * Math.log(x) - gammaLn(a)) * h
}

// 正则化不完全 beta I_x(a, b)（连分数）
function betaI(a: number, b: number, x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const lnbt = gammaLn(a + b) - gammaLn(a) - gammaLn(b) + a * Math.log(x) + b * Math.log(1 - x)
  const bt = Math.exp(lnbt)
  const qab = a + b
  const qap = a + 1
  const qam = a - 1
  let c = 1
  let d = 1 - (qab * x) / qap
  if (Math.abs(d) < 1e-300) d = 1e-300
  d = 1 / d
  let h = d
  for (let m = 1; m < 300; m++) {
    const m2 = 2 * m
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = 1 + aa / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    h *= d * c
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2))
    d = 1 + aa * d
    if (Math.abs(d) < 1e-300) d = 1e-300
    c = 1 + aa / c
    if (Math.abs(c) < 1e-300) c = 1e-300
    d = 1 / d
    const del = d * c
    h *= del
    if (Math.abs(del - 1) < 1e-14) break
  }
  return x < (a + 1) / (a + b + 2) ? (bt * h) / a : 1 - (bt * h) / b
}

function normalCdf(z: number): number {
  if (z === 0) return 0.5
  if (z > 6) return 1
  if (z < -6) return 0
  return z > 0 ? 0.5 + 0.5 * gammaP(0.5, z * z / 2) : 0.5 - 0.5 * gammaP(0.5, z * z / 2)
}

function tCdf(t: number, df: number): number {
  // P(T ≤ t)，双尾 p = 2 * (1 - tCdf(|t|, df)) = betaI(df/2, 0.5, df/(df+t²))
  const x = df / (df + t * t)
  return 1 - 0.5 * betaI(df / 2, 0.5, x)
}

function fCdf(F: number, df1: number, df2: number): number {
  // P(F ≤ f)
  const x = (df1 * F) / (df1 * F + df2)
  return betaI(df1 / 2, df2 / 2, x)
}

function chiSquareCdf(x: number, k: number): number {
  return gammaP(k / 2, x / 2)
}

// 通用反函数（单调递增假设，二分求解）
function invCdf(cdf: (v: number) => number, p: number, lo: number, hi: number): number {
  if (p <= 1e-300) return lo
  if (p >= 1 - 1e-12) return hi
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (cdf(mid) < p) lo = mid
    else hi = mid
    if (hi - lo < 1e-8 * Math.max(1, Math.abs(mid))) break
  }
  return (lo + hi) / 2
}

// ============ 相关与回归 ============

function pearson(x: number[], y: number[]): { r: number; p: number } {
  const n = x.length
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  if (sxx === 0 || syy === 0) return { r: 0, p: 1 }
  const r = sxy / Math.sqrt(sxx * syy)
  let p = 1
  if (n > 2 && r !== 1 && r !== -1) {
    const t = r * Math.sqrt((n - 2) / (1 - r * r))
    p = 2 * (1 - tCdf(Math.abs(t), n - 2))
  }
  return { r, p }
}

// 秩（ties 取平均秩）
function ranks(x: number[]): number[] {
  const idx = x.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v)
  const r = new Array(x.length)
  let i = 0
  while (i < x.length) {
    let j = i
    while (j + 1 < x.length && idx[j + 1].v === idx[i].v) j++
    const avgRank = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k].i] = avgRank
    i = j + 1
  }
  return r
}

function spearman(x: number[], y: number[]): { rho: number; p: number } {
  const res = pearson(ranks(x), ranks(y))
  return { rho: res.r, p: res.p }
}

// 最小二乘线性回归 y = a + b·x（均值中心化，数值稳定）
function linearFit(x: number[], y: number[]): {
  slope: number
  intercept: number
  r2: number
  slopeSE: number
  interceptSE: number
  p: number
  n: number
} {
  const n = x.length
  const mx = mean(x)
  const my = mean(y)
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx
    const dy = y[i] - my
    sxy += dx * dy
    sxx += dx * dx
    syy += dy * dy
  }
  const slope = sxy / sxx
  const intercept = my - slope * mx
  const ssRes = syy - (sxy * sxy) / sxx
  const r2 = 1 - ssRes / syy
  const sRes = Math.sqrt(ssRes / (n - 2))
  const slopeSE = sRes / Math.sqrt(sxx)
  const interceptSE = sRes * Math.sqrt(1 / n + (mx * mx) / sxx)
  let p = 1
  if (n > 2 && slope !== 0) {
    const t = slope / slopeSE
    p = 2 * (1 - tCdf(Math.abs(t), n - 2))
  }
  return { slope, intercept, r2, slopeSE, interceptSE, p, n }
}

// 多项式拟合（正规方程，x 先中心化缩放避免病态）
function polyFit(x: number[], y: number[], degree: number): { coefficients: number[]; r2: number } {
  const n = x.length
  const mx = mean(x)
  const sx = std(x, false)
  const xs = x.map((v) => (sx === 0 ? v - mx : (v - mx) / sx))
  const k = degree + 1
  const A: number[][] = []
  for (let i = 0; i < n; i++) {
    const row: number[] = []
    let pow = 1
    for (let j = 0; j < k; j++) {
      row.push(pow)
      pow *= xs[i]
    }
    A.push(row)
  }
  // 正规方程 (AᵀA)c = Aᵀy，高斯消元求解
  const AtA: number[][] = Array.from({ length: k }, () => new Array(k).fill(0))
  const Atb: number[] = new Array(k).fill(0)
  for (let i = 0; i < n; i++) {
    for (let p = 0; p < k; p++) {
      Atb[p] += A[i][p] * y[i]
      for (let q = 0; q < k; q++) AtA[p][q] += A[i][p] * A[i][q]
    }
  }
  const c = solveLinear(AtA, Atb)
  // 变换回原尺度：c0 + c1*((x-mx)/sx) + ... → 合并
  const coeff = new Array(k).fill(0)
  for (let j = 0; j < k; j++) {
    for (let p = j; p < k; p++) {
      // 展开 ((x-mx)/sx)^p 中 x^j 的系数
      const binom = combination(p, j)
      coeff[j] += c[p] * binom * Math.pow(1 / sx, p) * Math.pow(-mx, p - j)
    }
  }
  const yPred = x.map((v) => coeff.reduce((a, cc, j) => a + cc * Math.pow(v, j), 0))
  const my = mean(y)
  const ssRes = y.reduce((a, v, i) => a + (v - yPred[i]) ** 2, 0)
  const ssTot = y.reduce((a, v) => a + (v - my) ** 2, 0)
  const r2 = ssTot === 0 ? 1 : 1 - ssRes / ssTot
  return { coefficients: coeff, r2 }
}

function combination(n: number, k: number): number {
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let col = 0; col < n; col++) {
    let pivot = col
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r
    }
    ;[M[col], M[pivot]] = [M[pivot], M[col]]
    if (Math.abs(M[col][col]) < 1e-300) continue
    for (let r = 0; r < n; r++) {
      if (r === col) continue
      const f = M[r][col] / M[col][col]
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c]
    }
  }
  return M.map((row, i) => row[n] / (row[i] || 1))
}

// 指数拟合 y = a·e^(b·x)（对 y>0 数据，线性化 log(y)）
function exponentialFit(x: number[], y: number[]): { a: number; b: number; r2: number; n: number } {
  const ly = y.map(Math.log)
  const fit = linearFit(x, ly)
  const a = Math.exp(fit.intercept)
  const yPred = x.map((v) => a * Math.exp(fit.slope * v))
  const my = mean(y)
  const ssRes = y.reduce((s, v, i) => s + (v - yPred[i]) ** 2, 0)
  const ssTot = y.reduce((s, v) => s + (v - my) ** 2, 0)
  return { a, b: fit.slope, r2: ssTot === 0 ? 1 : 1 - ssRes / ssTot, n: x.length }
}

// ============ 假设检验 ============

function tTestOneSample(values: number[], mu: number): { t: number; df: number; p: number; mean: number; sd: number } {
  const n = values.length
  const m = mean(values)
  const sd = std(values)
  const se = sd / Math.sqrt(n)
  // sd=0 时 t 未定义：均值等于 μ 视为无差异（t=0, p=1），否则视为极端差异
  const t = se === 0 ? (m === mu ? 0 : m > mu ? Infinity : -Infinity) : (m - mu) / se
  const p = se === 0 ? (m === mu ? 1 : 0) : 2 * (1 - tCdf(Math.abs(t), n - 1))
  return { t, df: n - 1, p, mean: m, sd }
}

// Welch 独立双样本 t 检验（不假设等方差）
function tTestIndependent(a: number[], b: number[]): { t: number; df: number; p: number; meanA: number; meanB: number; diff: number } {
  const na = a.length
  const nb = b.length
  const ma = mean(a)
  const mb = mean(b)
  const va = variance(a)
  const vb = variance(b)
  const se = Math.sqrt(va / na + vb / nb)
  const t = se === 0 ? (ma === mb ? 0 : ma > mb ? Infinity : -Infinity) : (ma - mb) / se
  const df = Math.pow(va / na + vb / nb, 2) / (Math.pow(va / na, 2) / (na - 1) + Math.pow(vb / nb, 2) / (nb - 1))
  const p = se === 0 ? (ma === mb ? 1 : 0) : 2 * (1 - tCdf(Math.abs(t), df))
  return { t, df, p, meanA: ma, meanB: mb, diff: ma - mb }
}

function tTestPaired(a: number[], b: number[]): { t: number; df: number; p: number; meanDiff: number; sdDiff: number } {
  const d = a.map((v, i) => v - b[i])
  const n = d.length
  const md = mean(d)
  const sd = std(d)
  const se = sd / Math.sqrt(n)
  const t = se === 0 ? (md === 0 ? 0 : md > 0 ? Infinity : -Infinity) : (md - 0) / se
  const p = se === 0 ? (md === 0 ? 1 : 0) : 2 * (1 - tCdf(Math.abs(t), n - 1))
  return { t, df: n - 1, p, meanDiff: md, sdDiff: sd }
}

// Jarque-Bera 正态性检验
function jarqueBera(x: number[]): { jb: number; p: number; n: number } {
  const n = x.length
  const m = mean(x)
  const s = std(x, false)
  if (s === 0) return { jb: 0, p: 1, n }
  const s3 = x.reduce((a, v) => a + Math.pow((v - m) / s, 3), 0) / n
  const s4 = x.reduce((a, v) => a + Math.pow((v - m) / s, 4), 0) / n
  const jb = (n / 6) * (s3 * s3 + Math.pow(s4 - 3, 2) / 4)
  const p = 1 - chiSquareCdf(jb, 2)
  return { jb, p, n }
}

function movingAverage(x: number[], window: number): { smoothed: number[]; original: number[] } {
  const w = Math.max(1, Math.min(window, x.length))
  const out = new Array(x.length)
  let sum = 0
  for (let i = 0; i < x.length; i++) {
    sum += x[i]
    if (i >= w) sum -= x[i - w]
    out[i] = sum / Math.min(w, i + 1)
  }
  return { smoothed: out, original: x }
}

// ============ 格式化输出 ============

function fmt(v: number, digits = 4): string {
  if (typeof v !== 'number' || !isFinite(v)) return '—'
  if (v === 0) return '0'
  const abs = Math.abs(v)
  if (abs >= 1e5 || abs < 1e-4) return v.toExponential(2)
  return String(Math.round(v * Math.pow(10, digits)) / Math.pow(10, digits))
}

function fmtP(p: number): string {
  if (p < 1e-6) return `< 1e-6`
  if (p > 0.999999) return '> 0.999999'
  return fmt(p)
}

function describeTable(series: Array<{ name: string; values: number[] }>): string {
  const headers = ['指标', ...series.map((s) => s.name)]
  const sorted = series.map((s) => [...s.values].sort((a, b) => a - b))
  const rows: Array<[string, ...string[]]> = [
    ['样本数', ...series.map((s) => String(s.values.length))],
    ['均值', ...series.map((s) => fmt(mean(s.values)))],
    ['标准差', ...series.map((s) => fmt(std(s.values)))],
    ['方差', ...series.map((s) => fmt(variance(s.values)))],
    ['最小值', ...series.map((s) => fmt(Math.min(...s.values)))],
    ['25% 分位', ...sorted.map((s) => fmt(quantile(s, 0.25)))],
    ['中位数', ...sorted.map((s) => fmt(quantile(s, 0.5)))],
    ['75% 分位', ...sorted.map((s) => fmt(quantile(s, 0.75)))],
    ['最大值', ...series.map((s) => fmt(Math.max(...s.values)))],
    ['偏度', ...series.map((s) => fmt(skewness(s.values)))],
    ['超额峰度', ...series.map((s) => fmt(kurtosis(s.values)))]
  ]
  const lines = ['| ' + headers.join(' | ') + ' |', '|' + headers.map(() => '---|').join('')]
  for (const row of rows) lines.push('| ' + row.join(' | ') + ' |')
  return lines.join('\n')
}

// ============ 工具 ============

const OPERATIONS = [
  'describe',
  'correlation',
  'linear_fit',
  'polynomial_fit',
  'exponential_fit',
  'moving_average',
  'ttest_onesample',
  'ttest_independent',
  'ttest_paired',
  'normality'
] as const

const analysisSchema = z.object({
  operation: z
    .enum(OPERATIONS)
    .describe(
      '分析操作：describe 描述性统计 / correlation 两变量相关 / linear_fit 线性回归 / polynomial_fit 多项式拟合 / ' +
        'exponential_fit 指数拟合 / moving_average 移动平均平滑 / ttest_onesample 单样本 t 检验 / ' +
        'ttest_independent 独立双样本 t 检验 / ttest_paired 配对 t 检验 / normality 正态性检验'
    ),
  series: z
    .array(z.object({ name: z.string(), values: z.array(z.number()) }))
    .optional()
    .describe('待分析的数据系列（1 个或多个，每系列为等长数值数组）。describe/ttest/normality/moving_average 必填；相关与拟合可用 x/y 替代'),
  x: z.array(z.number()).optional().describe('自变量（correlation/linear_fit/polynomial_fit/exponential_fit 用；省略时取 series 第 1 列）'),
  y: z.array(z.number()).optional().describe('因变量（correlation/linear_fit/polynomial_fit/exponential_fit 用；省略时取 series 第 2 列）'),
  mu: z.number().optional().describe('ttest_onesample 假设均值，默认 0'),
  degree: z.number().int().min(1).max(6).optional().describe('polynomial_fit 多项式次数，默认 2'),
  window: z.number().int().min(2).max(100).optional().describe('moving_average 窗口大小，默认 3'),
  alpha: z.number().min(0.001).max(0.5).optional().describe('显著性水平（结果注释用），默认 0.05')
})

type AnalysisInput = z.infer<typeof analysisSchema>

const MAX_POINTS = 10000

function requireXY(input: AnalysisInput, series: Array<{ name: string; values: number[] }>): { x: number[]; y: number[] } | string {
  if (input.x && input.y) {
    if (input.x.length !== input.y.length) return 'x 与 y 长度不一致'
    return { x: input.x, y: input.y }
  }
  if (series.length < 2) return '需要两个数据系列：series[0] 为 x（自变量），series[1] 为 y（因变量）'
  if (series[0].values.length !== series[1].values.length) return 'x 与 y 系列长度不一致'
  return { x: series[0].values, y: series[1].values }
}

function validate(input: AnalysisInput): string | null {
  const series = input.series ?? []
  if (series.length === 0) {
    const fitOps = ['correlation', 'linear_fit', 'polynomial_fit', 'exponential_fit']
    if (!(fitOps.includes(input.operation) && input.x && input.y)) {
      return `${input.operation} 需要 series 数据系列`
    }
  }
  if (series.length > 6) return 'series 最多 6 个数据系列'
  for (const s of series) {
    if (s.values.length === 0) return `系列 "${s.name}" 为空`
    if (s.values.length > MAX_POINTS) return `系列 "${s.name}" 超过 ${MAX_POINTS} 个数据点，请先降采样`
    for (const v of s.values) {
      if (typeof v !== 'number' || !isFinite(v)) return `系列 "${s.name}" 包含无效数值`
    }
  }
  if (input.operation === 'ttest_independent' && series.length < 2) return 'ttest_independent 需要 2 个数据系列'
  if (input.operation === 'ttest_paired' && series.length < 2) return 'ttest_paired 需要 2 个数据系列'
  if (input.x && !input.y) return '提供了 x 但缺少 y'
  if (input.y && !input.x) return '提供了 y 但缺少 x'
  return null
}

export const dataAnalysisTool = new DynamicStructuredTool({
  name: 'data_analysis',
  description:
    '统计分析工具（scipy 风格），对数值数据做统计学习分析并返回 Markdown 结果。' +
    '支持操作：describe 描述性统计（均值/标准差/分位数/偏度/峰度）、correlation 相关分析（Pearson 和 Spearman）、' +
    'linear_fit 线性回归、polynomial_fit 多项式拟合、exponential_fit 指数拟合、moving_average 移动平均平滑、' +
    'ttest_onesample/ttest_independent/ttest_paired 假设检验、normality 正态性检验（Jarque-Bera）。' +
    '数据通过 series 传入（每系列 {name, values}）。相关/回归类操作可用 x/y 显式指定自变量与因变量，' +
    '或用 series 的两列。分析结果含显著性 p 值，请用结果数据回答问题。' +
    '需要可视化时再配合 plot_chart 工具画图。',
  schema: analysisSchema,
  func: async (input: AnalysisInput): Promise<string> => {
    const err = validate(input)
    if (err) return `❌ 参数错误: ${err}`
    const alpha = input.alpha ?? 0.05
    const series = input.series ?? []
    try {
      switch (input.operation) {
        case 'describe': {
          return `### 描述性统计\n${describeTable(series)}`
        }
        case 'correlation': {
          const xy = requireXY(input, series)
          if (typeof xy === 'string') return `❌ 参数错误: ${xy}`
          const p = pearson(xy.x, xy.y)
          const s = spearman(xy.x, xy.y)
          const sig = (v: number): string => (v < alpha ? '显著' : '不显著')
          return [
            `### 相关分析 (n=${xy.x.length})`,
            `| 方法 | 系数 | p 值 | 结论 (α=${alpha}) |`,
            '|---|---|---|---|',
            `| Pearson r | ${fmt(p.r)} | ${fmtP(p.p)} | ${sig(p.p)} |`,
            `| Spearman ρ | ${fmt(s.rho)} | ${fmtP(s.p)} | ${sig(s.p)} |`
          ].join('\n')
        }
        case 'linear_fit': {
          const xy = requireXY(input, series)
          if (typeof xy === 'string') return `❌ 参数错误: ${xy}`
          const f = linearFit(xy.x, xy.y)
          const sig = f.p < alpha ? '显著' : '不显著'
          return [
            `### 线性回归 y = a + b·x (n=${f.n})`,
            `| 参数 | 估计值 | 标准误 | p 值 |`,
            '|---|---|---|---|',
            `| 截距 a | ${fmt(f.intercept)} | ${fmt(f.interceptSE)} | ${fmtP(2 * (1 - tCdf(Math.abs(f.intercept / f.interceptSE), f.n - 2)))} |`,
            `| 斜率 b | ${fmt(f.slope)} | ${fmt(f.slopeSE)} | ${fmtP(f.p)} |`,
            '',
            `R² = ${fmt(f.r2)}，斜率显著性: ${sig} (α=${alpha})`,
            `拟合公式: y = ${fmt(f.intercept)} + ${fmt(f.slope)}·x`
          ].join('\n')
        }
        case 'polynomial_fit': {
          const xy = requireXY(input, series)
          if (typeof xy === 'string') return `❌ 参数错误: ${xy}`
          const degree = input.degree ?? 2
          const f = polyFit(xy.x, xy.y, degree)
          const terms = f.coefficients
            .map((c, j) => (c === 0 ? '' : `${fmt(c)}·x^${j}`))
            .filter(Boolean)
            .reverse()
            .join(' + ')
          return `### ${degree} 次多项式拟合 (n=${xy.x.length})\n\n拟合公式: y = ${terms || '0'}\n\nR² = ${fmt(f.r2)}`
        }
        case 'exponential_fit': {
          const xy = requireXY(input, series)
          if (typeof xy === 'string') return `❌ 参数错误: ${xy}`
          if (xy.y.some((v) => v <= 0)) return '❌ 指数拟合要求 y 全部大于 0'
          const f = exponentialFit(xy.x, xy.y)
          return [
            `### 指数拟合 y = a·e^(b·x) (n=${f.n})`,
            `| 参数 | 估计值 |`,
            '|---|---|',
            `| a | ${fmt(f.a)} |`,
            `| b | ${fmt(f.b)} |`,
            '',
            `R² = ${fmt(f.r2)}`,
            `拟合公式: y = ${fmt(f.a)} · e^(${fmt(f.b)}·x)`
          ].join('\n')
        }
        case 'moving_average': {
          const w = input.window ?? 3
          const s = series[0]
          const res = movingAverage(s.values, w)
          return `### 移动平均平滑 (窗口=${w}, n=${s.values.length})\n\n平滑后: [${res.smoothed.map((v) => fmt(v, 3)).join(', ')}]\n\n建议配合 plot_chart 绘制平滑曲线对比。`
        }
        case 'ttest_onesample': {
          const s = series[0]
          const mu = input.mu ?? 0
          const r = tTestOneSample(s.values, mu)
          return [
            `### 单样本 t 检验 (n=${s.values.length})`,
            `H₀: 总体均值 = ${mu}，H₁: 总体均值 ≠ ${mu}`,
            '',
            `| 指标 | 值 |`,
            '|---|---|',
            `| 样本均值 | ${fmt(r.mean)} |`,
            `| 样本标准差 | ${fmt(r.sd)} |`,
            `| t 统计量 | ${fmt(r.t)} |`,
            `| 自由度 | ${Math.round(r.df)} |`,
            `| p 值 | ${fmtP(r.p)} |`,
            `| 结论 | ${r.p < alpha ? `拒绝 H₀（显著差异）` : '无法拒绝 H₀（无显著差异）'} (α=${alpha}) |`
          ].join('\n')
        }
        case 'ttest_independent': {
          const a = series[0]
          const b = series[1]
          const r = tTestIndependent(a.values, b.values)
          return [
            `### 独立双样本 t 检验（Welch）`,
            `H₀: 两组均值相等，H₁: 两组均值不等`,
            '',
            `| 指标 | ${a.name} | ${b.name} |`,
            '|---|---|---|',
            `| 样本数 | ${a.values.length} | ${b.values.length} |`,
            `| 均值 | ${fmt(r.meanA)} | ${fmt(r.meanB)} |`,
            `| 均值差 | ${fmt(r.diff)} | — |`,
            `| t 统计量 | ${fmt(r.t)} | — |`,
            `| 自由度 | ${Math.round(r.df)} | — |`,
            `| p 值 | ${fmtP(r.p)} | — |`,
            `| 结论 | ${r.p < alpha ? '拒绝 H₀（两组差异显著）' : '无法拒绝 H₀（两组无显著差异）'} (α=${alpha}) | — |`
          ].join('\n')
        }
        case 'ttest_paired': {
          const a = series[0]
          const b = series[1]
          const r = tTestPaired(a.values, b.values)
          return [
            `### 配对 t 检验 (n=${a.values.length})`,
            `H₀: 配对差均值 = 0`,
            '',
            `| 指标 | 值 |`,
            '|---|---|',
            `| 均值差 | ${fmt(r.meanDiff)} |`,
            `| 差标准差 | ${fmt(r.sdDiff)} |`,
            `| t 统计量 | ${fmt(r.t)} |`,
            `| 自由度 | ${Math.round(r.df)} |`,
            `| p 值 | ${fmtP(r.p)} |`,
            `| 结论 | ${r.p < alpha ? '拒绝 H₀（差异显著）' : '无法拒绝 H₀（无显著差异）'} (α=${alpha}) |`
          ].join('\n')
        }
        case 'normality': {
          const s = series[0]
          const r = jarqueBera(s.values)
          return [
            `### 正态性检验（Jarque-Bera, n=${r.n}）`,
            `H₀: 数据服从正态分布`,
            '',
            `| 指标 | 值 |`,
            '|---|---|',
            `| JB 统计量 | ${fmt(r.jb)} |`,
            `| p 值 | ${fmtP(r.p)} |`,
            `| 结论 | ${r.p < alpha ? '拒绝 H₀（不服从正态分布）' : '无法拒绝 H₀（与正态分布无显著偏离）'} (α=${alpha}) |`
          ].join('\n')
        }
        default:
          return `❌ 不支持的操作: ${input.operation}`
      }
    } catch (e: any) {
      return `❌ 分析失败: ${e.message || String(e)}`
    }
  }
}) as unknown as Tool
