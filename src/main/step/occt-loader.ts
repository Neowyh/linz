// OpenCASCADE WASM（occt-import-js）加载器。
// 加载后的模块把 STEP/IGES/STL/OBJ 的 B-rep 三角化成网格。
import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

type OcctModule = any
let cached: Promise<OcctModule> | null = null

export class OcctLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OcctLoadError'
  }
}

/**
 * 解析 occt-import-js 所在目录（其 .js glue 与 .wasm 必须同目录）。
 * 优先应用自带（resources/occt），其次 dev 下 node_modules，最后进程上级 node_modules。
 */
function resolveOcctDir(): string {
  const candidates: string[] = [
    // 开发模式：项目根/resources/occt/
    path.join(app.getAppPath(), 'resources', 'occt'),
    // 打包后：<安装目录>/resources/occt/（electron-builder extraResources，脱离 asar 才能读 .wasm）
    path.join(process.resourcesPath, 'occt'),
    // dev：本项目 node_modules（依赖已安装时）
    path.join(process.cwd(), 'node_modules', 'occt-import-js', 'dist')
  ]
  for (const c of candidates) {
    try {
      const js = path.join(c, 'occt-import-js.js')
      const wasm = path.join(c, 'occt-import-js.wasm')
      if (fs.existsSync(js) && fs.existsSync(wasm)) return c
    } catch {
      // 忽略
    }
  }
  throw new OcctLoadError(
    '未找到 occt-import-js（OpenCASCADE WASM 转换引擎）。请确认应用已随包携带或已安装 occt-import-js。'
  )
}

/**
 * 获取 occt 模块（单例懒加载）。加载完成后使用 occt.ReadStepFile(buffer, params)。
 */
export function getOcct(): Promise<OcctModule> {
  if (cached) return cached
  cached = (async () => {
    const dir = resolveOcctDir()
    const gluePath = path.join(dir, 'occt-import-js.js')
    // glue 与 wasm 同目录，读 wasm 交给 glue 自身（Node 下用 fs.readFileSync）。
    // 传入 locateFile 使 wasm 从同目录解析，规避不同环境路径探测差异。
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const makeModule = require(gluePath)
      const mod = await makeModule({ locateFile: (p: string) => path.join(dir, p) })
      // 触发一次 wasm 实例化以提前暴露加载错误
      await mod.ReadStepFile
      return mod
    } catch (e: any) {
      cached = null
      throw new OcctLoadError(
        `OpenCASCADE WASM 加载失败: ${e?.message || String(e)}（路径 ${dir}）`
      )
    }
  })()
  return cached
}
