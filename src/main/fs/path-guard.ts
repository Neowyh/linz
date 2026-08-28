import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { buildSafeEnv } from '../security/env-sandbox'

const execFileAsync = promisify(execFile)

// 将用户输入路径解析为工作空间根目录内的绝对路径，并校验未越界。
// 供 Agent 文件工具（filesystem.tool.ts）与文件管理器 IPC（file-browser.ipc.ts）共用。
export function resolveWithinRoot(
  inputPath: string,
  root: string
): { ok: boolean; resolved?: string; error?: string } {
  const rootResolved = path.resolve(root)
  const resolved = path.resolve(rootResolved, inputPath)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
    return { ok: false, error: `路径越界，仅可访问工作空间目录内文件: ${rootResolved}` }
  }
  return { ok: true, resolved }
}

// 在 PATH 上查找可执行文件（用沙箱环境，避免泄露用户敏感环境变量）。
// 供 python.tool / html-to-word.tool / run-skill-script.tool 等需要兜底系统 PATH 的工具共用。
export async function findOnPath(name: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(os.platform() === 'win32' ? 'where' : 'which', [name], { env: buildSafeEnv() })
    const found = stdout.trim().split('\n')[0].trim()
    return found || null
  } catch {
    return null
  }
}

// 按序探测候选路径，返回第一个存在且为文件（exists+isFile）的路径，否则 null。
// 供内置二进制解析（python/pandoc 等）共用；各工具只需拼好候选列表。
export function probeFileCandidates(candidates: string[]): string | null {
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
    } catch {
      // 忽略 stat 异常，继续探测
    }
  }
  return null
}
