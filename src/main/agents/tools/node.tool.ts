import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import { execFile } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { randomUUID } from 'crypto'
import { buildSafeEnv } from '../../security/env-sandbox'
import { bundledNodeModulesPath, withBundledBinPath } from '../../resources'

const execFileAsync = promisify(execFile)

const EXEC_TIMEOUT = 120_000
const OUTPUT_LIMIT = 8000
// 生成的 PNG/图片经 base64 后较大，放宽 stdout 上限
const MAX_BUFFER = 50 * 1024 * 1024

// 单张图片最大字节数（原图），避免把超大图 base64 撑爆对话流
const MAX_IMAGE_BYTES = 3 * 1024 * 1024 // 3MB 原图 ≈ 4MB base64

interface NodeParams {
  code: string
}

function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n...（输出过长已截断，共 ${text.length} 字符）`
}

// 把一张图片文件编码成 <<<IMAGE>>>data:...;base64,...<<</IMAGE>>> 块（与 python 工具同格式）
function encodeImageBlock(filePath: string): string | null {
  try {
    const buf = fs.readFileSync(filePath)
    if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) return null
    const ext = path.extname(filePath).toLowerCase()
    const mime =
      ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
          : ext === '.svg' ? 'image/svg+xml'
            : ext === '.gif' ? 'image/gif'
              : 'image/png'
    const b64 = buf.toString('base64')
    return `<<<IMAGE>>>data:${mime};base64,${b64}<<</IMAGE>>>`
  } catch {
    return null
  }
}

// 从代码中解析 writeFile / writeFileSync 产出的图片路径（相对 cwd=tmpDir），自动转 IMAGE 块
const WRITEFILE_RE = /(?:writeFile|writeFileSync|save)\s*\(\s*['"]([^'"]+\.(?:png|jpe?g|svg|gif))['"]/g

function collectGeneratedImages(code: string, cwd: string): string[] {
  const blocks: string[] = []
  const seen = new Set<string>()
  let m: RegExpExecArray | null
  WRITEFILE_RE.lastIndex = 0
  while ((m = WRITEFILE_RE.exec(code)) !== null) {
    const rel = m[1]
    const abs = path.isAbsolute(rel) ? rel : path.resolve(cwd, rel)
    if (seen.has(abs)) continue
    seen.add(abs)
    const block = encodeImageBlock(abs)
    if (block) blocks.push(block)
  }
  return blocks
}

// 执行内联 JavaScript：用 Electron 自带的 Node 运行时（ELECTRON_RUN_AS_NODE），
// NODE_PATH 指向随包内置的 npm 库目录（docx / pptxgenjs 等），完全离线。
async function runNode(params: NodeParams): Promise<string> {
  const code = params?.code?.trim()
  if (!code) return '参数不完整：需要 code（要执行的 JavaScript 代码）'

  const nodeModules = bundledNodeModulesPath()
  if (!fs.existsSync(nodeModules)) {
    return '未找到内置 npm 库目录（docx/pptxgenjs 等）。请运行 `node scripts/prepare-skill-deps.cjs` 准备后重试。'
  }

  const tmpDir = os.tmpdir()
  const scriptPath = path.join(tmpDir, `linz-node-${randomUUID()}.js`)
  fs.writeFileSync(scriptPath, code, 'utf8')

  // 环境：Electron 自带 Node + 内置库 NODE_PATH + 白名单清洗 + 内置 bin 目录进 PATH
  const env = withBundledBinPath(
    buildSafeEnv({
      ELECTRON_RUN_AS_NODE: '1',
      NODE_PATH: nodeModules
    })
  )

  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath], {
      cwd: tmpDir,
      timeout: EXEC_TIMEOUT,
      maxBuffer: MAX_BUFFER,
      windowsHide: true,
      env
    })
    const parts: string[] = []
    if (stdout?.trim()) parts.push(truncateOutput(stdout.trim()))
    if (stderr?.trim()) parts.push(`标准错误:\n${truncateOutput(stderr.trim())}`)
    // 代码里 writeFile 出的图片自动追加 IMAGE 块，让模型直接看到图
    parts.push(...collectGeneratedImages(code, tmpDir))
    return parts.length > 0 ? parts.join('\n\n') : '执行完成（无输出）'
  } catch (err: any) {
    if (err.killed) return `执行超时（${EXEC_TIMEOUT / 1000} 秒）已终止`
    const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
    return `执行失败（退出码 ${err.code ?? '未知'}）: ${err.message || String(err)}${out ? `\n\n输出:\n${truncateOutput(out)}` : ''}`
  } finally {
    try {
      fs.unlinkSync(scriptPath)
    } catch {
      // 临时脚本清理失败可忽略
    }
  }
}

export const nodeTool = new DynamicStructuredTool({
  name: 'node',
  description: `执行内联 JavaScript 代码，使用应用内置的 Node 运行时与内置 npm 库（docx、pptxgenjs 已随应用内置，可直接 require，无需 npm install）。
输入 JSON: {"code": "要执行的 JS 代码"}

适用场景：
- 用 docx 库创建/生成 Word 文档（docx-js）
- 用 pptxgenjs 创建/生成 PPT 演示文稿
- 其他需要 Node 环境运行 JS 的场合

注意：代码里 require 的第三方库必须来自内置库（docx、pptxgenjs 等）；代码可读/写临时目录文件，图片文件（writeFileSync 输出 .png/.jpg/.svg）会自动以图片形式展示。生成的文件要保存到工作区目录并在回复中给出完整路径。`,
  schema: z.object({ code: z.string().describe('要执行的 JavaScript 代码') }),
  func: async (params: NodeParams): Promise<string> => runNode(params)
})

// 类型导出，供注册表使用
export const createNodeTool = (): Tool => nodeTool
