import { DynamicTool } from '@langchain/core/tools'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { dialog, BrowserWindow } from 'electron'
import { findSkillByNameOrId, listSkillScripts } from '../agent-skills.service'
import { getAppConfig } from '../../store/app-config'
import { detectPythonPath } from '../../mcp/templates'

const execFileAsync = promisify(execFile)

const EXEC_TIMEOUT = 60_000
const OUTPUT_LIMIT = 8000

interface RunSkillScriptParams {
  skill?: string
  script?: string
  args?: string
}

// 解析 args 字符串为参数数组（支持双/单引号包裹）
function parseArgs(raw?: string): string[] {
  if (!raw) return []
  const out: string[] = []
  for (const m of raw.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)) {
    out.push(m[1] ?? m[2] ?? m[3])
  }
  return out
}

async function findOnPath(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(os.platform() === 'win32' ? 'where' : 'which', [name])
    const found = stdout.trim().split('\n')[0].trim()
    return found || null
  } catch {
    return null
  }
}

interface Interpreter {
  command: string
  // 脚本路径之前的参数（如 cmd /c、powershell -File）
  beforeScript: string[]
  // true = 直接执行脚本文件本身（.exe），不拼脚本路径参数
  runDirect?: boolean
  env?: NodeJS.ProcessEnv
}

// 按扩展名分发解释器
async function resolveInterpreter(scriptPath: string): Promise<Interpreter | { error: string }> {
  const ext = path.extname(scriptPath).toLowerCase()
  const isWin = os.platform() === 'win32'

  switch (ext) {
    case '.py': {
      const py = await detectPythonPath()
      return py
        ? { command: py, beforeScript: [] }
        : { error: '未检测到 Python 解释器。请先安装 Python 并加入 PATH，或在设置中通过 MCP 模板检测 Python 环境。' }
    }
    case '.js':
    case '.mjs':
      // Electron 自带 Node 运行时（ELECTRON_RUN_AS_NODE），无需用户安装任何环境
      return { command: process.execPath, beforeScript: [], env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }
    case '.bat':
    case '.cmd':
      return isWin
        ? { command: process.env.ComSpec || 'cmd.exe', beforeScript: ['/c'] }
        : { error: '.bat/.cmd 脚本仅支持 Windows' }
    case '.ps1':
      return isWin
        ? { command: 'powershell.exe', beforeScript: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File'] }
        : { error: '.ps1 脚本仅支持 Windows' }
    case '.sh': {
      const bash = isWin ? await findOnPath('bash') : '/bin/bash'
      return bash
        ? { command: bash, beforeScript: [] }
        : { error: '未检测到 bash（.sh 脚本需要 bash 环境，Windows 可安装 Git Bash 或 WSL）' }
    }
    case '.exe':
    case '.com':
      return isWin
        ? { command: scriptPath, beforeScript: [], runDirect: true }
        : { error: '.exe 仅支持 Windows' }
    default:
      return { error: `不支持的脚本类型 ${ext || '(无扩展名)'}，支持: .py / .js / .bat / .cmd / .ps1 / .sh / .exe` }
  }
}

// 首次执行审批：信任此技能 / 仅一次 / 拒绝
async function requestApproval(skillName: string, commandLine: string): Promise<'trust' | 'once' | 'deny'> {
  const options = {
    type: 'warning' as const,
    title: '技能脚本执行确认',
    message: `技能「${skillName}」请求执行脚本`,
    detail: `即将执行：\n${commandLine}\n\n第三方技能脚本可能读写你的文件系统或访问网络，请确认技能来源可信。`,
    buttons: ['信任此技能并执行', '仅执行一次', '拒绝'],
    defaultId: 1,
    cancelId: 2,
    noLink: true
  }
  const win = BrowserWindow.getAllWindows()[0]
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options)
  return response === 0 ? 'trust' : response === 1 ? 'once' : 'deny'
}

function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n...（输出过长已截断，共 ${text.length} 字符）`
}

async function runSkillScript(params: RunSkillScriptParams): Promise<string> {
  const config = getAppConfig()
  if (!config.get('skillScriptEnabled')) {
    return '技能脚本执行未启用（默认关闭，防止不可信脚本自动运行）。请用户在 设置 → 高级 中开启「允许执行技能脚本」后重试。'
  }
  if (!params.skill?.trim() || !params.script?.trim()) {
    return '参数不完整：需要 skill（技能名称）和 script（脚本文件名，如 run.py 或 scripts/run.py）'
  }

  const skill = findSkillByNameOrId(params.skill)
  if (!skill) return `未找到启用中的技能「${params.skill}」`
  if (!skill.package_path) return `技能「${skill.name}」没有技能包目录（手动创建的技能不附带脚本）`

  // 路径校验：脚本必须位于 <package>/scripts/ 内，防目录穿越
  const scriptsRoot = path.resolve(skill.package_path, 'scripts')
  const relScript = params.script.replace(/\\/g, '/').replace(/^scripts\//, '')
  const scriptPath = path.resolve(scriptsRoot, relScript)
  if (!scriptPath.startsWith(scriptsRoot + path.sep)) {
    return '脚本路径非法：只能执行技能包 scripts/ 目录内的脚本'
  }
  if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
    const available = listSkillScripts(skill.package_path)
    return `脚本不存在: ${params.script}${available.length > 0 ? `\n该技能可用脚本: ${available.join('、')}` : '\n该技能包内没有 scripts/ 目录'}`
  }

  const interpreter = await resolveInterpreter(scriptPath)
  if ('error' in interpreter) return interpreter.error

  const args = [
    ...interpreter.beforeScript,
    ...(interpreter.runDirect ? [] : [scriptPath]),
    ...parseArgs(params.args)
  ]
  const commandLine = [interpreter.command, ...args].join(' ')

  // 首次信任审批：信任过的技能后续直接执行
  const trusted: string[] = (config.get('trustedSkillPackages') as string[] | undefined) || []
  if (!trusted.includes(skill.id)) {
    const decision = await requestApproval(skill.name, commandLine)
    if (decision === 'deny') return '用户拒绝了本次脚本执行'
    if (decision === 'trust') {
      config.set('trustedSkillPackages', [...trusted, skill.id])
    }
  }

  try {
    const { stdout, stderr } = await execFileAsync(interpreter.command, args, {
      cwd: skill.package_path,
      timeout: EXEC_TIMEOUT,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: interpreter.env || process.env
    })
    const parts: string[] = []
    if (stdout?.trim()) parts.push(`标准输出:\n${truncateOutput(stdout.trim())}`)
    if (stderr?.trim()) parts.push(`标准错误:\n${truncateOutput(stderr.trim())}`)
    return parts.length > 0 ? parts.join('\n\n') : '脚本执行完成（无输出）'
  } catch (err: any) {
    if (err.killed) return `脚本执行超时（${EXEC_TIMEOUT / 1000} 秒）已终止`
    const out = [err.stdout, err.stderr].filter(Boolean).join('\n').trim()
    return `脚本执行失败（退出码 ${err.code ?? '未知'}）: ${err.message || String(err)}${out ? `\n\n输出:\n${truncateOutput(out)}` : ''}`
  }
}

export const runSkillScriptTool = new DynamicTool({
  name: 'run_skill_script',
  description: `执行技能包附带的脚本文件。当技能内容中提到 scripts/ 下的脚本并要求执行时使用。
输入 JSON 格式参数:
- skill: 技能名称（必需，如 "翼型分析"）
- script: 脚本文件名（必需，如 "run.py" 或 "scripts/run.py"）
- args: 命令行参数字符串（可选，如 "--re 500000 --alpha 4"）

支持 .py（需系统 Python）/ .js（内置运行时）/ .bat / .cmd / .ps1 / .sh（需 bash）/ .exe。
脚本工作目录为技能包根目录，可使用相对路径引用包内 references/ 等资源。
返回脚本的标准输出/标准错误。需要在设置中开启「允许执行技能脚本」，首次执行需用户确认。

示例输入: {"skill":"翼型分析","script":"scripts/run_xfoil.py","args":"--naca 2412"}`,
  func: async (input: string): Promise<string> => {
    try {
      const params: RunSkillScriptParams = JSON.parse(input.trim())
      return await runSkillScript(params)
    } catch (err: any) {
      if (err instanceof SyntaxError) {
        return '参数解析失败：请输入有效 JSON，如 {"skill":"技能名","script":"run.py","args":"--help"}'
      }
      return `脚本执行出错: ${err?.message || String(err)}`
    }
  }
})
