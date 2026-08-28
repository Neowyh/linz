// 脚本执行的环境沙箱：白名单环境变量清洗。
// 独立成模块便于在纯 Node 环境下直接做确定性测试（不依赖 Electron）。

// 脚本进程环境变量白名单：丢弃用户完整环境，防止 API key/敏感变量泄露给脚本，
// 同时保留脚本运行所需的最小系统环境。
export const ENV_ALLOWLIST = [
  'PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'SystemDrive',
  'TEMP', 'TMP', 'COMSPEC', 'PATHEXT',
  'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'WINDIR',
  'ProgramFiles', 'ProgramFiles(x86)', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE'
]

export function buildSafeEnv(extra?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {}
  for (const key of ENV_ALLOWLIST) {
    const v = process.env[key]
    if (v !== undefined) env[key] = v
  }
  if (extra) Object.assign(env, extra)
  return env
}
