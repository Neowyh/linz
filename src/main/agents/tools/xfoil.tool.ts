import { DynamicTool } from '@langchain/core/tools'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

async function findXfoil(): Promise<string | null> {
  const platform = os.platform()
  const xfoilName = platform === 'win32' ? 'xfoil.exe' : 'xfoil'

  const commonPaths =
    platform === 'win32'
      ? [
          'C:\\XFOIL\\xfoil.exe',
          'C:\\Program Files\\XFOIL\\xfoil.exe',
          'C:\\Program Files (x86)\\XFOIL\\xfoil.exe'
        ]
      : ['/usr/local/bin/xfoil', '/usr/bin/xfoil', '/opt/xfoil/xfoil']

  for (const p of commonPaths) {
    try {
      await fs.promises.access(p, fs.constants.X_OK)
      return p
    } catch {
      continue
    }
  }

  try {
    const { stdout } = await execFileAsync(platform === 'win32' ? 'where' : 'which', [xfoilName])
    const found = stdout.trim().split('\n')[0]
    if (found) return found
  } catch {
    // not in PATH
  }

  return null
}

interface XfoilParams {
  airfoil?: string
  reynolds?: number
  mach?: number
  alphaRange?: [number, number, number]
}

async function runXfoil(params: XfoilParams): Promise<string> {
  const xfoilPath = await findXfoil()
  if (!xfoilPath) {
    return 'XFOIL 未安装或未找到。请从 https://web.mit.edu/drela/Public/web/xfoil/ 下载安装，或将 xfoil 可执行文件放置到 PATH 环境变量中。'
  }

  const airfoil = params.airfoil || '2412'
  const re = params.reynolds || 500000
  const mach = params.mach || 0
  const [alphaStart, alphaEnd, alphaStep] = params.alphaRange || [-2, 10, 0.5]

  const isNaca = /^naca\s*\d+/i.test(airfoil)
  const nacaNumber = airfoil.replace(/^naca\s*/i, '').trim()

  // Validate custom airfoil file path to prevent path traversal
  let safeAirfoilPath = airfoil
  if (!isNaca) {
    const ext = path.extname(airfoil).toLowerCase()
    if (ext !== '.dat' && ext !== '.txt') {
      return `自定义翼型文件仅支持 .dat 和 .txt 格式，当前文件: ${airfoil}`
    }
    const resolved = path.resolve(airfoil)
    const allowedDirs = [
      path.join(app.getPath('userData'), 'airfoils'),
      path.join(app.getPath('userData'), 'workspaces'),
      process.cwd()
    ]
    const isAllowed = allowedDirs.some(dir => resolved.startsWith(path.resolve(dir)))
    if (resolved.includes('..') || (!path.isAbsolute(airfoil) && !isAllowed)) {
      // Allow relative paths within allowed dirs
      if (path.isAbsolute(airfoil) && !isAllowed) {
        return `翼型文件路径不在允许的目录内，请将文件放置到用户数据目录下的 airfoils/ 文件夹`
      }
    }
    safeAirfoilPath = resolved
  }

  const commands = [
    isNaca ? `NACA ${nacaNumber}` : `LOAD ${safeAirfoilPath}`,
    'PANE',
    `RE ${re}`,
    mach > 0 ? `M ${mach}` : '',
    `ASEQ ${alphaStart} ${alphaEnd} ${alphaStep}`,
    'QUIT'
  ]
    .filter(Boolean)
    .join('\n')

  try {
    const { stdout } = await execFileAsync(xfoilPath, [], {
      input: commands,
      timeout: 30000,
      maxBuffer: 1024 * 1024
    } as Parameters<typeof execFileAsync>[2])

    return parseXfoilOutput(stdout as string)
  } catch (err: any) {
    if (err.killed) {
      return 'XFOIL 运行超时（30秒），请减小迎角范围或步长后重试。'
    }
    // XFOIL often writes results to stderr but still returns data
    if (err.stdout) {
      return parseXfoilOutput(err.stdout as string)
    }
    return `XFOIL 运行失败: ${err.message || String(err)}`
  }
}

function parseXfoilOutput(output: string): string {
  const lines = output.split('\n')
  const results: Array<{ alpha: number; cl: number; cd: number; cm: number }> = []

  // XFOIL polar output lines look like:
  //   0.000   0.2845   0.00853  ...  -0.0920
  // Match lines with 4+ numeric columns after the header separator
  let pastHeader = false
  for (const line of lines) {
    const trimmed = line.trim()
    // Detect header line like "  alpha        CL         CD ..."
    if (/alpha/i.test(trimmed) && /CL/i.test(trimmed)) {
      pastHeader = true
      continue
    }
    // Skip separator lines (----)
    if (/^[-\s]+$/.test(trimmed)) continue
    if (!pastHeader) continue

    const match = trimmed.match(
      /^\s*([-+]?\d+\.\d+)\s+([-+]?\d+\.\d+)\s+([-+]?\d+\.\d+)\s+([-+]?\d+\.\d+)/
    )
    if (match) {
      results.push({
        alpha: parseFloat(match[1]),
        cl: parseFloat(match[2]),
        cd: parseFloat(match[3]),
        cm: parseFloat(match[4])
      })
    }
  }

  if (results.length === 0) {
    return `XFOIL 运行完成，但未解析到有效气动力系数数据。可能原因：\n1. 翼型编号有误\n2. 雷诺数超出范围\n3. 迎角范围导致不收敛\n\n原始输出（截取）:\n${output.substring(0, 2000)}`
  }

  let table =
    '| 迎角 (°) | 升力系数 Cl | 阻力系数 Cd | 力矩系数 Cm |\n|---|---|---|---|\n'
  for (const r of results) {
    table += `| ${r.alpha.toFixed(2)} | ${r.cl.toFixed(4)} | ${r.cd.toFixed(6)} | ${r.cm.toFixed(4)} |\n`
  }

  // Add summary
  const maxCl = results.reduce((a, b) => (a.cl > b.cl ? a : b))
  const minCd = results.reduce((a, b) => (a.cd < b.cd ? a : b))
  const maxLd = results.reduce((a, b) =>
    a.cl / Math.max(a.cd, 1e-10) > b.cl / Math.max(b.cd, 1e-10) ? a : b
  )

  table += `\n**摘要**: 最大升力系数 Cl_max = ${maxCl.cl.toFixed(4)} (α=${maxCl.alpha.toFixed(1)}°), `
  table += `最小阻力系数 Cd_min = ${minCd.cd.toFixed(6)} (α=${minCd.alpha.toFixed(1)}°), `
  table += `最大升阻比 L/D_max = ${(maxLd.cl / Math.max(maxLd.cd, 1e-10)).toFixed(1)} (α=${maxLd.alpha.toFixed(1)}°)`

  return table
}

export const xfoilTool = new DynamicTool({
  name: 'xfoil_analysis',
  description: `运行 XFOIL 进行翼型气动力分析。输入 JSON 格式参数:
- airfoil: NACA翼型编号(如 "2412" 或 "NACA2412")或翼型数据文件路径
- reynolds: 雷诺数(默认 500000)
- mach: 马赫数(默认 0)
- alphaRange: 迎角范围 [起始, 终止, 步长](默认 [-2, 10, 0.5])

返回升力系数Cl、阻力系数Cd、力矩系数Cm随迎角变化表及摘要。
注意: 需要本地安装 XFOIL，如未安装会返回安装提示。

示例输入: {"airfoil":"2412","reynolds":500000,"alphaRange":[-2,10,0.5]}`,
  func: async (input: string): Promise<string> => {
    try {
      const params: XfoilParams = JSON.parse(input.trim())
      return await runXfoil(params)
    } catch (err: any) {
      return `XFOIL 分析失败: ${err.message || String(err)}。请确保输入为有效 JSON，如: {"airfoil":"2412","reynolds":500000,"alphaRange":[-2,10,0.5]}`
    }
  }
})
