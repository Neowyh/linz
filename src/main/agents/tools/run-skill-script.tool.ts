import { DynamicTool } from '@langchain/core/tools'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { findSkillByNameOrId, listSkillScripts } from '../agent-skills.service'
import { getAppConfig } from '../../store/app-config'
import { resolvePythonPath } from './python.tool'
import { buildSafeEnv } from '../../security/env-sandbox'
import { bundledNodeModulesPath, withBundledBinPath } from '../../resources'
import { checkPathAllowed } from '../../security/file-protection'
import { findOnPath } from '../../fs/path-guard'

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

interface Interpreter {
  command: string
  // 脚本路径之前的参数（如 cmd /c、powershell -File）
  beforeScript: string[]
  // true = 直接执行脚本文件本身（.exe），不拼脚本路径参数
  runDirect?: boolean
  // true = 经 cmd.exe /c 执行（.bat/.cmd），模型参数需做元字符校验防注入
  shellCmd?: boolean
  env?: NodeJS.ProcessEnv
}

// cmd.exe 对 argv 中的元字符（& | < > % ^ 等）会做特殊解释，
// 模型可控参数经 execFile 传给 cmd.exe /c 仍可能被注入（如 "& whoami"）。
// 对 .bat/.cmd 的模型参数做元字符检查：含危险字符则拒绝，引导改用 .py/.js。
const CMD_DANGEROUS_CHARS = /[&|<>%^`$\r\n]/
function validateCmdArgs(args: string[]): string | null {
  for (const a of args) {
    if (CMD_DANGEROUS_CHARS.test(a)) {
      return `参数含 cmd.exe 元字符，.bat/.cmd 脚本不支持此类参数（"${a}"）。请改用 .py/.js 脚本处理含特殊字符的参数。`
    }
  }
  return null
}

// 按扩展名分发解释器
// scriptsRoot 用于给 .py 脚本设 PYTHONPATH，使同级模块导入（如 morningstar render.py 的 from chart_builders import ...）生效
async function resolveInterpreter(scriptPath: string, scriptsRoot: string): Promise<Interpreter | { error: string }> {
  const ext = path.extname(scriptPath).toLowerCase()
  const isWin = os.platform() === 'win32'

  switch (ext) {
    case '.py': {
      // 优先内置便携 Python 3.8.10（预装 numpy/scipy/pandas/matplotlib 及 docx/pdf/xlsx 技能依赖），其次系统 PATH
      const py = await resolvePythonPath()
      if (!py) {
        return { error: '未找到 Python 解释器（内置便携版缺失且系统无 python）。请运行 `node scripts/prepare-python.cjs` 准备便携 Python，或在系统安装 Python 后加入 PATH。' }
      }
      // 便携 Python 的 python38._pth 会忽略 PYTHONPATH，改由 sitecustomize.py 读取的
      // LINZ_PYTHONPATH 注入 scripts 根目录与脚本所在目录，覆盖同级模块导入和嵌套子目录脚本
      const pyPath = [scriptsRoot, path.dirname(scriptPath)]
        .filter((p, i, arr) => arr.indexOf(p) === i)
        .join(path.delimiter)
      // 内置 bin 目录（pandoc/poppler）进 PATH，脚本内可 subprocess 调用
      return { command: py, beforeScript: [], env: withBundledBinPath(buildSafeEnv({ LINZ_PYTHONPATH: pyPath })) }
    }
    case '.js':
    case '.mjs':
      // Electron 自带 Node 运行时（ELECTRON_RUN_AS_NODE），无需用户安装任何环境；
      // NODE_PATH 指向随包内置 npm 库（docx/pptxgenjs），脚本可直接 require
      return {
        command: process.execPath,
        beforeScript: [],
        env: withBundledBinPath(buildSafeEnv({ ELECTRON_RUN_AS_NODE: '1', NODE_PATH: bundledNodeModulesPath() }))
      }
    case '.bat':
    case '.cmd':
      return isWin
        ? { command: process.env.ComSpec || 'cmd.exe', beforeScript: ['/c'], shellCmd: true }
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

function truncateOutput(text: string): string {
  if (text.length <= OUTPUT_LIMIT) return text
  return text.slice(0, OUTPUT_LIMIT) + `\n...（输出过长已截断，共 ${text.length} 字符）`
}

async function runSkillScript(params: RunSkillScriptParams): Promise<string> {
  if (!params.skill?.trim() || !params.script?.trim()) {
    return '参数不完整：需要 skill（技能名称）和 script（脚本文件名，如 run.py 或 scripts/run.py）'
  }

  const skill = findSkillByNameOrId(params.skill)
  if (!skill) return `未找到启用中的技能「${params.skill}」`

  // 内置技能脚本随应用打包且经过审查，不受「允许执行技能脚本」总开关限制
  // （每次执行仍有审批卡拦截）；用户导入的不可信自定义技能需在设置中开启开关。
  const config = getAppConfig()
  if (!config.get('skillScriptEnabled') && !skill.is_builtin) {
    return '技能脚本执行未启用（默认关闭，防止不可信脚本自动运行）。请用户在 设置 → 高级 中开启「允许执行技能脚本」后重试。'
  }
  if (!skill.package_path) return `技能「${skill.name}」没有技能包目录（手动创建的技能不附带脚本）`

  // 文件防护：技能包目录命中受保护路径则拦截
  const protectPkg = checkPathAllowed(skill.package_path)
  if (!protectPkg.ok) return `⛔ 文件防护拦截：技能包目录命中受保护路径（${protectPkg.protectedPath}）`

  // 路径校验：脚本必须位于 <package>/scripts/ 内，防目录穿越
  const scriptsRoot = path.resolve(skill.package_path, 'scripts')
  const relScript = params.script.replace(/\\/g, '/').replace(/^scripts\//, '')
  const scriptPath = path.resolve(scriptsRoot, relScript)
  if (!scriptPath.startsWith(scriptsRoot + path.sep)) {
    return '脚本路径非法：只能执行技能包 scripts/ 目录内的脚本'
  }
  // 文件防护：脚本文件命中受保护路径则拦截
  const protectScript = checkPathAllowed(scriptPath)
  if (!protectScript.ok) return `⛔ 文件防护拦截：脚本路径命中受保护路径（${protectScript.protectedPath}）`
  if (!fs.existsSync(scriptPath) || !fs.statSync(scriptPath).isFile()) {
    const available = listSkillScripts(skill.package_path)
    return `脚本不存在: ${params.script}${available.length > 0 ? `\n该技能可用脚本: ${available.join('、')}` : '\n该技能包内没有 scripts/ 目录'}`
  }

  const interpreter = await resolveInterpreter(scriptPath, scriptsRoot)
  if ('error' in interpreter) return interpreter.error

  const modelArgs = parseArgs(params.args)
  // .bat/.cmd 经 cmd.exe /c 执行，模型参数含元字符会被 cmd.exe 解释为命令注入
  if (interpreter.shellCmd) {
    const cmdErr = validateCmdArgs(modelArgs)
    if (cmdErr) return cmdErr
  }

  const args = [
    ...interpreter.beforeScript,
    ...(interpreter.runDirect ? [] : [scriptPath]),
    ...modelArgs
  ]

  // 执行审批由安全策略门统一处理（risk=execute 默认 ask，弹聊天内审批卡），
  // 此处不再重复弹窗。运行环境使用白名单清洗后的最小环境，防敏感变量泄露。
  try {
    const { stdout, stderr } = await execFileAsync(interpreter.command, args, {
      cwd: skill.package_path,
      timeout: EXEC_TIMEOUT,
      maxBuffer: 1024 * 1024,
      windowsHide: true,
      env: interpreter.env || buildSafeEnv()
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
