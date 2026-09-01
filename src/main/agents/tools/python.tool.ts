import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { app } from 'electron'
import { buildSafeEnv } from '../../security/env-sandbox'
import { withBundledBinPath } from '../../resources'
import { findOnPath, probeFileCandidates } from '../../fs/path-guard'

const execFileAsync = promisify(execFile)

// Python 脚本执行超时：matplotlib 画图 + scipy 计算可能较慢，给 120s（与 stream-handler 默认一致）
const EXEC_TIMEOUT = 120_000
const OUTPUT_LIMIT = 8000

// maxBuffer 调到 50MB：matplotlib 生成的 PNG 经 base64 编码后容易远超 4MB，
// 默认 4MB 会让 execFileAsync 抛错走 catch，图片根本进不了 stdout
const MAX_BUFFER = 50 * 1024 * 1024

// 单张图片最大字节数（原图），避免把超大图 base64 撑爆对话流
const MAX_IMAGE_BYTES = 3 * 1024 * 1024 // 3MB 原图 ≈ 4MB base64

// 仅当代码引用 matplotlib 时自动注入 Agg 后端 + 中文字体，避免 embeddable 环境无 GUI 后端报错 / 中文乱码
const MATPLOTLIB_RE = /\bmatplotlib\b|\bpyplot\b|\b\.savefig\b/

// 自动注入头：
//   1. Agg 后端（embeddable 无 GUI）
//   2. 中文字体：优先系统常见中文字体，逐个探测可用性后设 rcParams
//      matplotlib 默认 DejaVu Sans 无中文字形，中文会显示成方框（tofu）
//   3. axes.unicode_minus=False：负号用 ASCII "-"，否则负号也是缺失字形
const PREPENDED_HEADER = `# === 临智 自动注入（请勿删除）===
import matplotlib
matplotlib.use('Agg')
import matplotlib.font_manager as _fm
_zh_fonts = ['Microsoft YaHei', 'SimHei', 'SimSun', 'KaiTi', 'PingFang SC', 'Noto Sans CJK SC', 'WenQuanYi Zen Hei']
_avail = {f.name for f in _fm.fontManager.ttflist}
_chosen = next((f for f in _zh_fonts if f in _avail), None)
if _chosen:
    matplotlib.rcParams['font.sans-serif'] = [_chosen] + matplotlib.rcParams.get('font.sans-serif', [])
    matplotlib.rcParams['axes.unicode_minus'] = False
# === /自动注入 ===
`

interface PythonParams {
  code: string
}

// 便携 Python 可执行文件名（按平台）
function pythonBinName(): string {
  return os.platform() === 'win32' ? 'python.exe' : 'python3'
}

// 便携 Python 目录名（按平台；mac/linux 暂留空，靠系统 PATH 兜底）
function pythonBinDir(): string {
  return os.platform() === 'win32' ? 'python' : ''
}

// 解析 Python 可执行文件：优先应用自带便携版（resources/bin/<platform>/python/），其次系统 PATH
export async function resolvePythonPath(): Promise<string | null> {
  const bin = pythonBinName()
  const candidates: string[] = []

  if (os.platform() === 'win32') {
    const subDir = pythonBinDir()
    // 开发模式：项目根/resources/bin/win32/python/python.exe
    candidates.push(path.join(app.getAppPath(), 'resources', 'bin', process.platform, subDir, bin))
    // 打包后：<安装目录>/resources/bin/win32/python/python.exe（electron-builder extraResources）
    candidates.push(path.join(process.resourcesPath, 'bin', process.platform, subDir, bin))
  }

  // 候选都不在则兜底系统 PATH 上的 python
  return probeFileCandidates(candidates) ?? await findOnPath(bin)
}

function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n...（输出过长已截断，共 ${text.length} 字符）`
}

// 把一张图片文件编码成 <<<IMAGE>>>data:...;base64,...<<</IMAGE>>> 块
function encodeImageBlock(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath)
    if (buf.length === 0) return null
    if (buf.length > MAX_IMAGE_BYTES) {
      return null // 超大图跳过，避免撑爆对话流
    }
    const ext = path.extname(filePath).toLowerCase()
    const mime =
      ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.svg' ? 'image/svg+xml'
            : ext === '.gif' ? 'image/gif'
              : 'image/png' // 默认按 png
    const b64 = buf.toString('base64')
    return `<<<IMAGE>>>data:${mime};base64,${b64}<<</IMAGE>>>`
  } catch {
    return null
  }
}

// 从代码中解析出 savefig / imwrite 等产出的图片文件路径（相对 cwd=tmpDir）
const SAVEFIG_RE = /(?:savefig|imwrite)\s*\(\s*['"]([^'"]+)['"]/g

// 兜底：把代码里 savefig/imwrite 产出的图片自动转成 IMAGE 块追加到输出末尾。
// 这样模型只需 plt.savefig("a.png")，工具自动让它显示在对话中，不必自己写 base64 编码。
function collectGeneratedImages(code: string, cwd: string): string[] {
  const blocks: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  SAVEFIG_RE.lastIndex = 0
  while ((m = SAVEFIG_RE.exec(code)) !== null) {
    const rel = m[1]
    const abs = path.isAbsolute(rel) ? rel : path.resolve(cwd, rel)
    if (seen.has(abs)) continue
    seen.add(abs)
    if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
      const block = encodeImageBlock(abs)
      if (block) blocks.push(block)
    }
  }
  return blocks
}

// 将模型代码写入临时文件并执行。
// 用 -I（isolated）减少环境污染；cwd 设临时目录避免读写到工作区。
async function runPython(params: PythonParams): Promise<string> {
  if (!params.code?.trim()) {
    return '参数不完整：需要 code（要执行的 Python 代码）'
  }

  const pyExe = await resolvePythonPath()
  if (!pyExe) {
    return '❌ 未找到 Python 解释器。应用未携带便携 Python，且系统 PATH 上也没有 python。' +
      '请运行 `node scripts/prepare-python.cjs` 准备便携 Python 3.8.10，或在系统安装 Python 后加入 PATH。'
  }

  // 代码预处理：引用 matplotlib 时自动注入 Agg 后端
  const needsAgg = MATPLOTLIB_RE.test(params.code)
  const finalCode = needsAgg ? PREPENDED_HEADER + params.code : params.code

  const tmpDir = os.tmpdir()
  const scriptPath = path.join(tmpDir, `linz-py-${randomUUID()}.py`)
  fs.writeFileSync(scriptPath, finalCode, { encoding: 'utf-8' })

  let stdout = ''
  let stderr = ''
  let killed = false
  let exitErr: any = null

  try {
    try {
      const r = await execFileAsync(pyExe, ['-I', scriptPath], {
        cwd: tmpDir,
        timeout: EXEC_TIMEOUT,
        maxBuffer: MAX_BUFFER,
        windowsHide: true,
        // 白名单环境 + 内置 bin 目录进 PATH：让内联代码能 subprocess 调用随包带的 pandoc/pdftoppm 等
        env: withBundledBinPath(buildSafeEnv())
      })
      stdout = r.stdout || ''
      stderr = r.stderr || ''
    } catch (err: any) {
      killed = !!err.killed
      exitErr = err
      // execFile 超时或 maxBuffer 超限时仍会带 stdout/stderr
      stdout = err.stdout || ''
      stderr = err.stderr || ''
    }

    // 兜底：自动把 savefig/imwrite 产出的图片转成 IMAGE 块（模型不必自己写 base64）
    const imageBlocks = collectGeneratedImages(params.code, tmpDir)

    const parts: string[] = []
    if (stdout?.trim()) parts.push(`标准输出:\n${truncateOutput(stdout.trim())}`)
    if (stderr?.trim()) parts.push(`标准错误:\n${truncateOutput(stderr.trim())}`)
    if (imageBlocks.length > 0) {
      // IMAGE 块追加到末尾；stream-handler 的 extractImageBlocks 会提取并转成对话内图片
      parts.push(imageBlocks.join('\n'))
    }

    if (killed) return `Python 执行超时（${EXEC_TIMEOUT / 1000} 秒）已终止`
    // 有输出或有图就返回，非零退出码也附在前面（但不阻断图片展示）
    const body = parts.length > 0 ? parts.join('\n\n') : '脚本执行完成（无输出）'
    if (exitErr && exitErr.code !== 0 && exitErr.code !== undefined) {
      return `⚠️ 退出码 ${exitErr.code}\n\n${body}`
    }
    return body
  } finally {
    try { fs.unlinkSync(scriptPath) } catch { /* 忽略清理失败 */ }
  }
}

export const pythonTool = new DynamicStructuredTool({
  name: 'python',
  description:
    '执行内嵌的 Python 3.8.10 代码并返回输出。预装 numpy / matplotlib / scipy / pandas，' +
    '适合数值计算、数据处理、可视化绘图。\n\n' +
    '画图时只需用 matplotlib 画完调用 plt.savefig("图名.png") 保存即可，' +
    '工具会自动把保存的图片显示在对话中（无需你手动 base64 编码）。\n\n' +
    '注意：代码在受限环境执行（不携带用户敏感环境变量），首次执行需用户确认。\n' +
    '示例：画正弦曲线——\n' +
    'import numpy as np, matplotlib.pyplot as plt\n' +
    'x = np.linspace(0, 10, 100)\n' +
    'plt.plot(x, np.sin(x))\n' +
    'plt.title("正弦曲线")\n' +
    'plt.savefig("sine.png")',
  schema: z.object({
    code: z.string().describe('要执行的完整 Python 代码（3.8 语法）。可使用 numpy/scipy/pandas/matplotlib。')
  }),
  func: async (input: PythonParams): Promise<string> => {
    try {
      return await runPython(input)
    } catch (err: any) {
      return `❌ Python 执行过程出错: ${err?.message || String(err)}`
    }
  }
}) as unknown as Tool
