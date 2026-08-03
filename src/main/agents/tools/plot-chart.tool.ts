import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import { IMAGE_BLOCK_START, IMAGE_BLOCK_END } from '../../llm/image-protocol'

// plot_chart：Node 端纯文本生成 SVG 图表（零外部依赖，Win7 兼容）。
// 输出以 <<<IMAGE>>>data:image/svg+xml;base64,...<<<\/IMAGE>>> 协议块包装，
// 由 stream-handler 提取后直接以 markdown 图片进入对话流。

const PALETTE = ['#1E6FCC', '#FA8C16', '#CF1322', '#08979C', '#722ED1', '#389E0D', '#EB2F96', '#2F54EB', '#F5222D', '#A0D911']

const CHART_TYPES = ['line', 'bar', 'scatter', 'area', 'pie'] as const

const chartSchema = z.object({
  chartType: z.enum(CHART_TYPES).describe('图表类型：line 折线图 / bar 柱状图 / scatter 散点图 / area 面积图 / pie 饼图'),
  title: z.string().describe('图表标题（简洁，如 "升力系数随迎角变化"）'),
  xLabel: z.string().optional().describe('x 轴标签（如 "迎角 (deg)"）'),
  yLabel: z.string().optional().describe('y 轴标签（如 "升力系数 Cl"）'),
  xCategories: z.array(z.string()).optional().describe('x 轴分类标签，柱状图与饼图必填（数据点较多时可省略，自动用序号）'),
  xValues: z.array(z.number()).optional().describe('x 轴数值（折线/散点/面积图可选，不提供时按数据索引均匀分布）'),
  series: z.array(z.object({
    name: z.string().describe('系列名称，如 "优化前"'),
    data: z.array(z.number()).describe('该系列的数据点，长度需与其他系列一致')
  })).describe('数据系列，1-6 个'),
  width: z.number().int().min(320).max(1600).optional().describe('图片宽度 px，默认 720'),
  height: z.number().int().min(240).max(1200).optional().describe('图片高度 px，默认 420')
})

type ChartInput = z.infer<typeof chartSchema>

// ---------- 通用工具 ----------

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatNum(v: number): string {
  if (Number.isInteger(v)) return String(v)
  const abs = Math.abs(v)
  if (abs >= 100000 || (abs < 0.01 && v !== 0)) return v.toExponential(1).replace('e+', 'e')
  return String(Math.round(v * 1000) / 1000)
}

// "漂亮"刻度算法：1/2/5 步进
function niceNum(range: number, round: boolean): number {
  const exponent = Math.floor(Math.log10(range))
  const fraction = range / Math.pow(10, exponent)
  let niceFraction: number
  if (round) {
    if (fraction < 1.5) niceFraction = 1
    else if (fraction < 3) niceFraction = 2
    else if (fraction < 7) niceFraction = 5
    else niceFraction = 10
  } else {
    if (fraction <= 1) niceFraction = 1
    else if (fraction <= 2) niceFraction = 2
    else if (fraction <= 5) niceFraction = 5
    else niceFraction = 10
  }
  return niceFraction * Math.pow(10, exponent)
}

function niceTicks(min: number, max: number, count = 5): { min: number; max: number; step: number; ticks: number[] } {
  const range = max - min
  if (!isFinite(range) || range <= 0) return { min, max, step: 1, ticks: [min, max] }
  const step = niceNum(range / (count - 1), true)
  const niceMin = Math.floor(min / step) * step
  const niceMax = Math.ceil(max / step) * step
  const ticks: number[] = []
  for (let v = niceMin; v <= niceMax + step * 1e-6; v += step) {
    ticks.push(Math.abs(v) < step * 1e-6 ? 0 : v)
  }
  return { min: niceMin, max: niceMax, step, ticks }
}

function linePoints(xs: number[], ys: number[]): string {
  return xs.map((x, i) => `${x.toFixed(1)},${ys[i].toFixed(1)}`).join(' ')
}

function polyline(points: string, color: string, width = 2.5): string {
  return `<polyline fill="none" stroke="${color}" stroke-width="${width}" stroke-linejoin="round" stroke-linecap="round" points="${points}"/>`
}

function circles(xs: number[], ys: number[], color: string): string {
  return xs.map((x, i) => `<circle cx="${x.toFixed(1)}" cy="${ys[i].toFixed(1)}" r="3.5" fill="${color}"/>`).join('')
}

// 图例：横排，必要时换行
function buildLegend(items: Array<{ name: string; color: string }>, startY: number, maxWidth: number): string {
  const parts: string[] = []
  let x = 0
  let y = startY
  for (const item of items) {
    const w = item.name.length * 13 + 42
    if (x + w > maxWidth) {
      x = 0
      y += 20
    }
    parts.push(
      `<rect x="${x}" y="${y - 10}" width="12" height="12" rx="2" fill="${item.color}"/>` +
      `<text x="${x + 17}" y="${y}" font-size="12" fill="#555">${esc(item.name)}</text>`
    )
    x += w
  }
  return parts.join('')
}

// 分类 x 轴刻度标签（间隔显示避免重叠）
function categoryTickLabels(labels: string[], n: number, x0: number, x1: number, y: number, maxChars = 12): string {
  const stride = Math.max(1, Math.ceil(n / 10))
  const parts: string[] = []
  for (let i = 0; i < n; i++) {
    if (i % stride !== 0) continue
    const cx = x0 + ((n === 1 ? 0.5 : i / (n - 1)) * (x1 - x0))
    let label = labels[i] ?? String(i)
    if (label.length > maxChars) label = label.slice(0, maxChars - 1) + '…'
    parts.push(`<text x="${cx.toFixed(1)}" y="${y}" font-size="11" fill="#888" text-anchor="middle">${esc(label)}</text>`)
  }
  return parts.join('')
}

// 数值 x 轴刻度标签
function numericTickLabels(ticks: number[], x0: number, x1: number, y: number): string {
  return ticks.map((t) => {
    const cx = x0 + ((t - ticks[0]) / (ticks[ticks.length - 1] - ticks[0] || 1)) * (x1 - x0)
    return `<text x="${cx.toFixed(1)}" y="${y}" font-size="11" fill="#888" text-anchor="middle">${formatNum(t)}</text>`
  }).join('')
}

// ---------- 笛卡尔系图表（line/area/scatter/bar） ----------

interface CartesianLayout {
  width: number
  height: number
  x0: number
  x1: number
  y0: number
  y1: number
}

function renderCartesian(input: ChartInput): string {
  const width = input.width ?? 720
  const height = input.height ?? 420
  const plot: CartesianLayout = { width, height, x0: 64, x1: width - 24, y0: 40, y1: height - 52 }
  const n = Math.max(...input.series.map((s) => s.data.length))
  if (n === 0) throw new Error('数据系列为空')

  const isBar = input.chartType === 'bar'
  const hasNumericX = !isBar && Array.isArray(input.xValues) && input.xValues.length === n

  // y 轴范围：全非负则从 0 起
  const allVals = input.series.flatMap((s) => s.data)
  const rawMin = Math.min(...allVals)
  const rawMax = Math.max(...allVals)
  const yMin = rawMin >= 0 ? 0 : rawMin
  const yScale = niceTicks(yMin, rawMax, 5)
  const yPx = (v: number): number => plot.y1 - ((v - yScale.min) / (yScale.max - yScale.min || 1)) * (plot.y1 - plot.y0)

  // x 像素映射
  const xFor = (i: number, xv?: number): number => {
    if (hasNumericX && xv !== undefined) {
      const xs = input.xValues!
      const xsMin = Math.min(...xs)
      const xsMax = Math.max(...xs)
      return plot.x0 + ((xv - xsMin) / (xsMax - xsMin || 1)) * (plot.x1 - plot.x0)
    }
    return plot.x0 + (n === 1 ? 0.5 : i / (n - 1)) * (plot.x1 - plot.x0)
  }

  const parts: string[] = []

  // 标题
  parts.push(`<text x="${width / 2}" y="24" font-size="15" font-weight="bold" fill="#333" text-anchor="middle">${esc(input.title || '')}</text>`)

  // y 网格 + 刻度标签
  for (const t of yScale.ticks) {
    const y = yPx(t)
    parts.push(`<line x1="${plot.x0}" y1="${y.toFixed(1)}" x2="${plot.x1}" y2="${y.toFixed(1)}" stroke="#eee" stroke-width="1"/>`)
    parts.push(`<text x="${plot.x0 - 8}" y="${(y + 4).toFixed(1)}" font-size="11" fill="#888" text-anchor="end">${formatNum(t)}</text>`)
  }

  // x 轴与标签
  parts.push(`<line x1="${plot.x0}" y1="${plot.y1}" x2="${plot.x1}" y2="${plot.y1}" stroke="#999" stroke-width="1"/>`)
  if (hasNumericX) {
    const xs = input.xValues!
    const xTicks = niceTicks(Math.min(...xs), Math.max(...xs), 5)
    for (const t of xTicks.ticks) {
      const cx = plot.x0 + ((t - xTicks.min) / (xTicks.max - xTicks.min || 1)) * (plot.x1 - plot.x0)
      parts.push(`<line x1="${cx.toFixed(1)}" y1="${plot.y1}" x2="${cx.toFixed(1)}" y2="${plot.y1 + 4}" stroke="#999" stroke-width="1"/>`)
      parts.push(`<text x="${cx.toFixed(1)}" y="${plot.y1 + 18}" font-size="11" fill="#888" text-anchor="middle">${formatNum(t)}</text>`)
    }
  } else if (!isBar) {
    const stride = Math.max(1, Math.ceil(n / 10))
    for (let i = 0; i < n; i += stride) {
      const cx = xFor(i)
      parts.push(`<line x1="${cx.toFixed(1)}" y1="${plot.y1}" x2="${cx.toFixed(1)}" y2="${plot.y1 + 4}" stroke="#999" stroke-width="1"/>`)
      const label = input.xCategories?.[i] ?? String(i)
      parts.push(`<text x="${cx.toFixed(1)}" y="${plot.y1 + 18}" font-size="11" fill="#888" text-anchor="middle">${esc(String(label))}</text>`)
    }
  }

  // 坐标轴标签
  if (input.yLabel) {
    parts.push(
      `<text x="14" y="${((plot.y0 + plot.y1) / 2).toFixed(1)}" font-size="12" fill="#666" text-anchor="middle" transform="rotate(-90 14 ${((plot.y0 + plot.y1) / 2).toFixed(1)})">${esc(input.yLabel)}</text>`
    )
  }
  if (input.xLabel) {
    parts.push(`<text x="${((plot.x0 + plot.x1) / 2).toFixed(1)}" y="${height - 12}" font-size="12" fill="#666" text-anchor="middle">${esc(input.xLabel)}</text>`)
  }

  // 柱状图：分组并排
  if (isBar) {
    const m = input.series.length
    const groupW = (plot.x1 - plot.x0) / n
    const barW = Math.min(36, (groupW * 0.72) / m)
    input.series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length]
      const bars = s.data.map((v, i) => {
        const bx = xFor(i) - groupW / 2 + (si + 0.5) * (groupW * 0.72 / m) - barW / 2
        const by = yPx(v)
        const bh = Math.max(0, plot.y1 - by)
        return `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${barW.toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${color}" opacity="0.88"/>`
      })
      parts.push(bars.join(''))
    })
    const labels = input.xCategories ?? input.series[0].data.map((_, i) => String(i))
    parts.push(categoryTickLabels(labels, n, plot.x0, plot.x1, plot.y1 + 18))
  } else {
    // 折线 / 面积 / 散点
    input.series.forEach((s, si) => {
      const color = PALETTE[si % PALETTE.length]
      const xs = s.data.map((_, i) => xFor(i, input.xValues?.[i]))
      const ys = s.data.map(yPx)
      if (input.chartType === 'area') {
        const pts = `${plot.x0.toFixed(1)},${plot.y1} ${linePoints(xs, ys)} ${plot.x1.toFixed(1)},${plot.y1}`
        parts.push(`<polygon points="${pts}" fill="${color}" opacity="0.15" stroke="none"/>`)
        parts.push(polyline(linePoints(xs, ys), color))
        if (n <= 80) parts.push(circles(xs, ys, color))
      } else if (input.chartType === 'scatter') {
        parts.push(circles(xs, ys, color))
      } else {
        parts.push(polyline(linePoints(xs, ys), color))
        if (n <= 80) parts.push(circles(xs, ys, color))
      }
    })
  }

  // 图例
  if (input.series.length > 1) {
    const legendItems = input.series.map((s, si) => ({ name: s.name, color: PALETTE[si % PALETTE.length] }))
    parts.push(buildLegend(legendItems, 40, plot.x1 - plot.x0))
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">${parts.join('')}</svg>`
}

// ---------- 饼图 ----------

function renderPie(input: ChartInput): string {
  const width = input.width ?? 720
  const height = input.height ?? 420
  const data = input.series[0].data
  const labels = input.xCategories ?? data.map((_, i) => String(i))
  if (data.length === 0) throw new Error('饼图数据为空')
  const total = data.reduce((a, b) => a + b, 0)
  if (!isFinite(total) || total <= 0) throw new Error('饼图数据总和必须大于 0')

  const cx = width / 2
  const cy = height / 2 + 4
  const r = Math.min(width, height) * 0.32

  const parts: string[] = []
  parts.push(`<text x="${width / 2}" y="24" font-size="15" font-weight="bold" fill="#333" text-anchor="middle">${esc(input.title || '')}</text>`)

  const n = data.length
  let angle = -Math.PI / 2
  for (let i = 0; i < n; i++) {
    const frac = data[i] / total
    const start = angle
    const end = angle + frac * Math.PI * 2
    angle = end
    const color = PALETTE[i % PALETTE.length]
    const x1 = cx + r * Math.cos(start)
    const y1 = cy + r * Math.sin(start)
    const x2 = cx + r * Math.cos(end)
    const y2 = cy + r * Math.sin(end)
    const largeArc = frac > 0.5 ? 1 : 0
    const path = `M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r.toFixed(1)} ${r.toFixed(1)} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z`
    parts.push(`<path d="${path}" fill="${color}" stroke="#fff" stroke-width="1.5"/>`)

    // 百分比标签（扇区中点，半径 0.68 处）
    const mid = (start + end) / 2
    const lx = cx + r * 0.68 * Math.cos(mid)
    const ly = cy + r * 0.68 * Math.sin(mid)
    const pct = `${Math.round(frac * 1000) / 10}%`
    parts.push(`<text x="${lx.toFixed(1)}" y="${(ly + 4).toFixed(1)}" font-size="11.5" fill="#fff" text-anchor="middle" font-weight="bold">${pct}</text>`)
  }

  // 图例（底部）
  const legendItems = labels.map((name, i) => ({ name, color: PALETTE[i % PALETTE.length] }))
  parts.push(buildLegend(legendItems, height - 16, width - 40))

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="-apple-system, 'Segoe UI', 'Microsoft YaHei', sans-serif">${parts.join('')}</svg>`
}

function validateInput(input: ChartInput): string | null {
  if (!input.series || input.series.length === 0) return 'series 至少需要 1 个数据系列'
  if (input.series.length > 6) return 'series 最多 6 个数据系列'
  const n = input.series[0].data.length
  if (n === 0) return 'series 数据为空'
  for (const s of input.series) {
    if (s.data.length !== n) return `系列 "${s.name}" 数据长度 (${s.data.length}) 与其他系列 (${n}) 不一致`
    for (const v of s.data) {
      if (typeof v !== 'number' || !isFinite(v)) return `系列 "${s.name}" 包含无效数值`
    }
  }
  if (input.chartType === 'pie' && input.series.length > 1) return '饼图只支持 1 个数据系列'
  if (input.xValues && input.xValues.length !== n) return `xValues 长度 (${input.xValues.length}) 与数据长度 (${n}) 不一致`
  return null
}

export const plotChartTool = new DynamicStructuredTool({
  name: 'plot_chart',
  description: '绘制数据图表并直接显示在对话中。支持折线图 line / 柱状图 bar / 散点图 scatter / 面积图 area / 饼图 pie。' +
    '调用后图片会自动出现在回复中，你无需在文字里描述图表。' +
    '适合展示气动性能曲线（Cl-Cd、极曲线）、参数对比、统计分布等。' +
    '数据点超过 200 个时请先降采样或聚合。',
  schema: chartSchema,
  func: async (input: ChartInput): Promise<string> => {
    try {
      const error = validateInput(input)
      if (error) return `❌ 图表参数错误: ${error}`
      const svg = input.chartType === 'pie' ? renderPie(input) : renderCartesian(input)
      const dataUrl = `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
      const summary = `✅ 已生成${input.chartType === 'line' ? '折线图' : input.chartType === 'bar' ? '柱状图' : input.chartType === 'scatter' ? '散点图' : input.chartType === 'area' ? '面积图' : '饼图'}「${input.title || '图表'}」(${input.series.length} 个系列, ${input.series[0].data.length} 个数据点)`
      return `${summary}\n${IMAGE_BLOCK_START}${dataUrl}${IMAGE_BLOCK_END}`
    } catch (err: any) {
      return `❌ 图表生成失败: ${err.message || String(err)}`
    }
  }
}) as unknown as Tool
