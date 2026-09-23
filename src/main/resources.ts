// 随包资源（resources/）定位与子进程环境辅助。
// 资源在开发模式下位于 <项目根>/resources，打包后位于 <安装目录>/resources
// （electron-builder extraResources，脱离 asar）。统一在这里解析，避免各处重复 dev/prod 判断。

import path from 'path'
import os from 'os'
import fs from 'fs'
import { app } from 'electron'

// 解析随包资源绝对路径，rel 形如 "skills/agent-skill-docx" 或 "bin/win32"
export function resolveBundledPath(rel: string): string {
  const base = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources')
  return path.join(base, rel)
}

// 内置二进制目录（pandoc.exe / python / poppler 等），按平台
export function bundledBinDirs(): string[] {
  const dirs: string[] = []
  if (os.platform() === 'win32') {
    dirs.push(resolveBundledPath(path.join('bin', 'win32')))
    dirs.push(resolveBundledPath(path.join('bin', 'win32', 'poppler')))
  }
  return dirs
}

// 把内置 bin 目录追加到环境变量 PATH（去重、忽略不存在的目录）。
// 供 python / node / run_skill_script 的子进程通过 subprocess 直接找到
// pandoc、pdftoppm、pdftotext、pdfinfo、pdfimages 等。
export function withBundledBinPath(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const existing = env.PATH || env.Path || ''
  const sep = os.platform() === 'win32' ? ';' : ':'
  const additions = bundledBinDirs().filter((d) => fs.existsSync(d))
  if (additions.length === 0) return env
  const joined = [...additions, ...existing.split(sep)]
    .filter((p, i, arr) => p && arr.indexOf(p) === i)
  return { ...env, PATH: joined.join(sep) }
}

// 内置 npm 库目录（docx / pptxgenjs 等），供 node 工具的 NODE_PATH 使用
export function bundledNodeModulesPath(): string {
  return resolveBundledPath(path.join('skills', 'node_modules'))
}
