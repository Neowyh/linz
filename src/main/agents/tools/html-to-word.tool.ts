import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import * as fs from 'fs'
import * as path from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'
import { randomUUID } from 'crypto'
import { app, BrowserWindow, dialog } from 'electron'
import { buildSafeEnv } from '../../security/env-sandbox'
import { findOnPath, probeFileCandidates } from '../../fs/path-guard'

const execFileAsync = promisify(execFile)

// 转换进程超时（pandoc 本体很快，主要是大文档 + 图片）
const CONVERT_TIMEOUT_MS = 120_000

// 模块级并发锁：防止多 Agent 同时调用本工具导致多个原生对话框叠加
let busy = false

// ============ HTML 编码探测 / 图片内联（避免乱码与图片丢失） ============

const META_CHARSET_RE = /<meta[^>]*charset\s*=\s*["']?\s*([\w-]+)\s*["']?/i
const HTTP_EQUIV_CHARSET_RE = /<meta[^>]*http-equiv\s*=\s*["']?content-type["']?[^>]*content\s*=\s*["'][^"']*charset=([\w-]+)/i
// 已知的非 UTF-8 常见编码及其 TextDecoder 标签
const ENCODING_LABELS: Record<string, string> = {
  gbk: 'gbk',
  gb2312: 'gbk',
  gb18030: 'gb18030',
  big5: 'big5',
  'big-5': 'big5',
  'shift_jis': 'shift_jis',
  'shift-jis': 'shift_jis',
  sjis: 'shift_jis',
  'euc-kr': 'euc-kr',
  'utf-16': 'utf-16le',
  'utf-16le': 'utf-16le',
  'utf-16be': 'utf-16be'
}

export function hasUtf8Bom(b: Buffer): boolean {
  return b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf
}

/** 从 HTML 头部的 meta 声明推断声明的字符集（仅 ASCII 安全扫描前 2KB） */
export function detectDeclaredCharset(buffer: Buffer): string | null {
  const head = buffer.subarray(0, 2048).toString('latin1')
  const m = head.match(META_CHARSET_RE) || head.match(HTTP_EQUIV_CHARSET_RE)
  return m ? m[1].toLowerCase() : null
}

/** 读取原始字节并解码为 JS 字符串；返回实际采用的编码标签 */
export function decodeHtmlBuffer(buffer: Buffer): { text: string; encoding: string } {
  if (hasUtf8Bom(buffer)) {
    return { text: buffer.subarray(3).toString('utf-8'), encoding: 'utf-8' }
  }
  if (buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: buffer.subarray(2).toString('utf16le'), encoding: 'utf-16le' }
  }
  const declared = detectDeclaredCharset(buffer)
  const utf8 = buffer.toString('utf-8')
  const utf8Valid = !utf8.includes('\uFFFD')

  // 明文声明了非 UTF-8 编码 → 按声明标签解码
  if (declared && ENCODING_LABELS[declared]) {
    try {
      return { text: new TextDecoder(ENCODING_LABELS[declared]).decode(buffer), encoding: ENCODING_LABELS[declared] }
    } catch {
      // 标签解码失败，继续走下面的兜底
    }
  }
  // 未声明 / 声明 utf-8：UTF-8 合法则直接用，否则回退 GBK（中文 Windows 最常见）
  if (utf8Valid) {
    return { text: utf8, encoding: 'utf-8' }
  }
  try {
    return { text: new TextDecoder('gbk').decode(buffer), encoding: 'gbk' }
  } catch {
    return { text: utf8, encoding: 'utf-8' }
  }
}

const IMG_SRC_RE = /<img([^>]*)\bsrc\s*=\s*(["'])([^"']*)\2([^>]*)>/gi

function mimeFromExt(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  const map: Record<string, string> = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.webp': 'image/webp',
    '.bmp': 'image/bmp', '.tif': 'image/tiff', '.tiff': 'image/tiff'
  }
  return map[ext] || 'application/octet-stream'
}

/** 把 img src 解析为本地文件绝对路径；无法解析返回 null */
export function resolveLocalSrc(src: string, baseDir: string): string | null {
  const s = src.trim().replace(/^file:\/\/\/?(localhost\/)?/i, '').replace(/\\/g, '/')
  if (!s || /^(data:|https?:|ftps?:|\/\/)/i.test(s)) return null
  // 绝对盘符路径（C:/ 或 C:\）或网络共享（\\server）
  if (/^[a-zA-Z]:\//.test(s) || /^\/\//.test(s)) {
    return s.replace(/^\//, '')
  }
  const resolved = path.resolve(baseDir, s)
  return resolved
}

/** 将 HTML 字符串里的本地图片 src 内联为 data URI；返回替换数量 */
export function inlineLocalImages(text: string, baseDir: string): { html: string; count: number } {
  let count = 0
  const html = text.replace(IMG_SRC_RE, (match, _before, quote, src, _after) => {
    if (/^data:/i.test(src)) return match
    const filePath = resolveLocalSrc(src, baseDir)
    if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return match
    try {
      const buf = fs.readFileSync(filePath)
      const dataUri = `data:${mimeFromExt(filePath)};base64,${buf.toString('base64')}`
      count++
      return match.replace(/src\s*=\s*["'][^"']*["']/i, `src="${dataUri}"`)
    } catch {
      return match
    }
  })
  return { html, count }
}

/**
 * 准备 pandoc 输入：识别编码 → 转 UTF-8 → 内联本地图片 → 写入临时文件。
 * 返回临时文件绝对路径与原 HTML 所在目录（供 --resource-path 兜底）。
 * 调用方负责在 finally 中删除临时文件。
 */
export function prepareTempHtml(htmlPath: string): { tempPath: string; originalDir: string } {
  const buffer = fs.readFileSync(htmlPath)
  const { text, encoding } = decodeHtmlBuffer(buffer)

  let prepared = text
  // 统一 meta charset 为 utf-8（临时文件按 UTF-8 写入，避免声明与实际不符）
  prepared = prepared.replace(
    /charset\s*=\s*["']?[\w-]+["']?/gi,
    (m) => (/\bcharset\b/i.test(m) ? 'charset="utf-8"' : m)
  )
  if (!/<meta[^>]*charset/i.test(prepared)) {
    prepared = prepared.replace(/<head[^>]*>/i, (h) => h + '<meta charset="utf-8">')
  }

  const originalDir = path.dirname(htmlPath)
  const { html, count } = inlineLocalImages(prepared, originalDir)

  const tempPath = path.join(os.tmpdir(), `html2word-${randomUUID()}.html`)
  fs.writeFileSync(tempPath, html, { encoding: 'utf-8' })
  if (process.env.HTML2WORD_DEBUG) {
    console.log(`[html_to_word] 编码=${encoding} 内联图片=${count} temp=${tempPath}`)
  }
  return { tempPath, originalDir }
}

// ============ 原生对话框辅助 ============

// 取一个存活的主窗口作为对话框父窗口（模态），同 chat.ipc.ts 的取窗模式
function getDialogParent(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
}

// pandoc 二进制文件名（按平台）
function pandocBinName(): string {
  return os.platform() === 'win32' ? 'pandoc.exe' : 'pandoc'
}

// 解析 pandoc 可执行文件：优先应用自带（resources/bin），其次系统安装，最后 PATH
async function resolvePandocPath(): Promise<string | null> {
  const bin = pandocBinName()
  const candidates: string[] = [
    // 开发模式：项目根/resources/bin/<platform>/
    path.join(app.getAppPath(), 'resources', 'bin', process.platform, bin),
    // 打包后：<安装目录>/resources/bin/<platform>/（electron-builder extraResources）
    path.join(process.resourcesPath, 'bin', process.platform, bin),
    // 常见系统安装位置
    'C:\\Program Files\\Pandoc\\pandoc.exe',
    'C:\\Program Files (x86)\\Pandoc\\pandoc.exe'
  ]
  return probeFileCandidates(candidates) ?? await findOnPath('pandoc')
}

const PANDOC_MISSING_MSG =
  '❌ 未找到 pandoc。请安装 pandoc（https://pandoc.org/installing.html）后重试，' +
  '或确认应用已随包携带 pandoc 可执行文件。'

interface HtmlToWordParams {
  task?: string
  inputHtmlPath?: string
  referenceTemplatePath?: string
  outputPath?: string
}

/** 选择输入 HTML 文件；取消返回 null 表示用户放弃 */
async function pickHtmlFile(win?: BrowserWindow): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: '选择要转换为 Word 的 HTML 文件',
    properties: ['openFile'],
    filters: [{ name: 'HTML 文件', extensions: ['html', 'htm'] }]
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/** 选择参考 Word 模板；取消返回 null 表示不使用模板 */
async function pickTemplateFile(win?: BrowserWindow, defaultDir?: string): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    title: '选择参考 Word 模板（取消则使用 pandoc 默认样式）',
    properties: ['openFile'],
    defaultPath: defaultDir,
    filters: [
      { name: 'Word 模板 / 文档', extensions: ['docx', 'dotx'] },
      { name: '所有文件', extensions: ['*'] }
    ]
  }
  const result = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

/** 选择输出另存位置；取消返回 null 表示用户放弃 */
async function pickOutputPath(win?: BrowserWindow, defaultPath?: string): Promise<string | null> {
  const opts: Electron.SaveDialogOptions = {
    title: '保存转换后的 Word 文档',
    defaultPath,
    filters: [{ name: 'Word 文档', extensions: ['docx'] }]
  }
  const result = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
  if (result.canceled || !result.filePath) return null
  return result.filePath
}

async function htmlToWord(params: HtmlToWordParams): Promise<string> {
  // 并发锁：避免双工具同时弹多个对话框
  if (busy) {
    return '⏳ 另一个 HTML→Word 转换正在进行中，请稍后再试。'
  }
  busy = true
  let tempPath: string | null = null
  try {
    const win = getDialogParent()
    const htmlDir = params.inputHtmlPath ? path.dirname(params.inputHtmlPath) : undefined

    // 1. 输入 HTML
    let htmlPath = params.inputHtmlPath?.trim() || null
    if (!htmlPath) {
      htmlPath = await pickHtmlFile(win)
    }
    if (!htmlPath) {
      return '❌ 已取消：未选择输入 HTML 文件，转换未执行。可以直接在参数中传入文件路径，或重新调用。'
    }
    if (!fs.existsSync(htmlPath) || !fs.statSync(htmlPath).isFile()) {
      return `❌ 输入 HTML 文件不存在: ${htmlPath}`
    }

    // 2. 参考模板（可选，取消=不套模板）
    let templatePath: string | null = params.referenceTemplatePath?.trim() || null
    if (!templatePath) {
      templatePath = await pickTemplateFile(win, htmlDir)
    }

    // 3. 输出保存位置
    let outPath: string | null = params.outputPath?.trim() || null
    if (!outPath) {
      const base = path.basename(htmlPath, path.extname(htmlPath))
      const defaultOut = path.join(htmlDir || os.homedir(), `${base}.docx`)
      outPath = await pickOutputPath(win, defaultOut)
    }
    if (!outPath) {
      return '❌ 已取消保存，转换未执行。'
    }

    // 4. 解析 pandoc
    const pandoc = await resolvePandocPath()
    if (!pandoc) {
      return PANDOC_MISSING_MSG
    }

    // 5. 规范化输入：编码转 UTF-8 + 本地图片内联（解决乱码/图片丢失）
    const prep = prepareTempHtml(htmlPath)
    tempPath = prep.tempPath

    // 6. 运行转换（基于规范化后的临时文件；资源路径仍指向原目录兜底）
    const args = [prep.tempPath, '-f', 'html', '-t', 'docx']
    args.push(`--resource-path=${prep.originalDir}`)
    if (templatePath) args.push(`--reference-doc=${templatePath}`)
    args.push('-o', outPath)

    try {
      const { stdout, stderr } = await execFileAsync(pandoc, args, {
        cwd: prep.originalDir,
        timeout: CONVERT_TIMEOUT_MS,
        maxBuffer: 4 * 1024 * 1024,
        windowsHide: true,
        env: buildSafeEnv()
      })
      if (!fs.existsSync(outPath)) {
        return `❌ pandoc 转换失败（未生成输出文件）。\n${(stdout || stderr || '').trim() || '无错误输出'}`
      }
      const size = fs.statSync(outPath).size
      const templateNote = templatePath
        ? `参考模板已应用: ${templatePath}`
        : '未使用参考模板（pandoc 默认样式）。\n提示：如模板含图注/表注样式，请确保其保留标准英文样式名（Image Caption / Table Caption）以完整套用。'
      return `✅ 已生成 Word 文档:\n${outPath}\n（${size} 字节）\n${templateNote}`
    } catch (err: any) {
      const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
      return `❌ 转换失败（${err.code ?? '未知退出码'}）: ${err.message || String(err)}${out ? `\n\n输出:\n${out}` : ''}`
    }
  } finally {
    // 清理规范化临时文件
    if (tempPath) {
      try {
        fs.unlinkSync(tempPath)
      } catch {
        // 忽略清理失败
      }
    }
    busy = false
  }
}

export const htmlToWordTool = new DynamicStructuredTool({
  name: 'html_to_word',
  description:
    '将 HTML 文档转换为 Word 文档，并可套用参考 Word 模板的样式（支持标题/正文/图片/表格/图注/表注）。' +
    '当用户要求"把 HTML 转成 Word"、"生成 Word 报告并套用模板"时使用。' +
    '调用后工具会依次弹出对话框让用户选择输入 HTML 文件、参考模板（可跳过）和保存位置；' +
    '若对话中已明确给出文件路径，也可直接传入参数。参数均可选。',
  schema: z.object({
    task: z.string().optional().describe('用户的转换需求描述，如"把研究报告转成 Word 并套用公司模板"'),
    inputHtmlPath: z.string().optional().describe('输入 HTML 文件绝对路径（留空则弹出对话框让用户选择）'),
    referenceTemplatePath: z.string().optional().describe('参考 Word 模板 .docx/.dotx 绝对路径（留空则弹出对话框选择，可取消跳过）'),
    outputPath: z.string().optional().describe('输出 .docx 保存路径（留空则弹出另存为对话框）')
  }),
  func: async (input: HtmlToWordParams): Promise<string> => {
    try {
      return await htmlToWord(input)
    } catch (err: any) {
      return `❌ 转换过程出错: ${err?.message || String(err)}`
    }
  }
}) as unknown as Tool