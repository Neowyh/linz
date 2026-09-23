import { app } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolveBundledPath } from '../resources'
import type { CordisContext, DshPluginDescriptor, DshPluginModule, DshPluginConfig } from './types'

const PLUGINS_DIR = path.join(app.getPath('userData'), 'dsh-plugins')
const DATA_DIR = path.join(app.getPath('userData'), 'dsh-data')

interface LoadedPlugin {
  descriptor: DshPluginDescriptor
  module: DshPluginModule
  dispose?: () => void
}

/**
 * Scans the `dsh-plugins/` directory for DSH plugin packages, dynamically
 * imports each ESM entry, and calls `apply(ctx, config)` with the Cordis
 * context and parsed configuration.
 *
 * The loader reads `package.json` for the `dsh` descriptor block and
 * `cordis.patch.yml` for default config (translating DSH-specific `!!js`
 * tags like `dshHomePath()` into local userData paths).
 */
export class PluginLoader {
  private readonly loaded = new Map<string, LoadedPlugin>()

  constructor(private readonly ctx: CordisContext) {}

  async startAll(): Promise<void> {
    // 将随包携带的 DSH 插件复制到 userData/dsh-plugins/（首次运行或版本更新时）
    await this.seedBundledPlugins()

    if (!fs.existsSync(PLUGINS_DIR)) {
      fs.mkdirSync(PLUGINS_DIR, { recursive: true })
      return
    }

    const entries = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const packageDir = path.join(PLUGINS_DIR, entry.name)
      try {
        await this.loadPlugin(packageDir)
      } catch (err) {
        console.error(`[DSH] Failed to load plugin ${entry.name}:`, err)
      }
    }
  }

  /**
   * 将随包携带的 DSH 插件从 resources/dsh-plugins/ 复制到 userData/dsh-plugins/。
   *
   * 打包后插件位于 <安装目录>/resources/dsh-plugins/<name>/（脱离 asar），
   * 但 PluginLoader 只扫描 userData/dsh-plugins/，因此需要在首次启动时
   * 将随包插件复制过去。已安装且版本相同的插件会被跳过，避免覆盖用户改动。
   */
  private async seedBundledPlugins(): Promise<void> {
    const bundledDir = resolveBundledPath('dsh-plugins')
    if (!fs.existsSync(bundledDir)) return

    fs.mkdirSync(PLUGINS_DIR, { recursive: true })

    const entries = fs.readdirSync(bundledDir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sourceDir = path.join(bundledDir, entry.name)
      const targetDir = path.join(PLUGINS_DIR, entry.name)
      if (!this.shouldSeedPlugin(sourceDir, targetDir)) continue

      try {
        fs.cpSync(sourceDir, targetDir, { recursive: true, force: true })
        console.log(`[DSH] Seeded bundled plugin: ${entry.name}`)
      } catch (err) {
        console.error(`[DSH] Failed to seed bundled plugin ${entry.name}:`, err)
      }
    }
  }

  /**
   * 判断是否需要复制随包插件：
   * - 目标不存在 → 复制（全新安装）
   * - 版本不同 → 覆盖更新（应用升级后自动更新插件）
   * - 版本相同 → 跳过
   */
  private shouldSeedPlugin(sourceDir: string, targetDir: string): boolean {
    const sourcePkgPath = path.join(sourceDir, 'package.json')
    if (!fs.existsSync(sourcePkgPath)) return false

    const targetPkgPath = path.join(targetDir, 'package.json')
    if (!fs.existsSync(targetPkgPath)) return true

    try {
      const sourcePkg = JSON.parse(fs.readFileSync(sourcePkgPath, 'utf8'))
      const targetPkg = JSON.parse(fs.readFileSync(targetPkgPath, 'utf8'))
      return sourcePkg.version !== targetPkg.version
    } catch {
      // package.json 解析失败，保守复制
      return true
    }
  }

  async loadPlugin(packageDir: string): Promise<string | null> {
    // Read package.json
    const pkgPath = path.join(packageDir, 'package.json')
    if (!fs.existsSync(pkgPath)) {
      console.warn(`[DSH] No package.json in ${packageDir}`)
      return null
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'))
    const dshBlock = pkg.dsh
    if (!dshBlock) {
      console.warn(`[DSH] No "dsh" block in ${pkgPath}`)
      return null
    }

    // Parse cordis.patch.yml for default config
    const config = this.parsePatchConfig(packageDir, dshBlock, pkg.name)

    // Build descriptor
    const descriptor: DshPluginDescriptor = {
      name: pkg.name,
      version: pkg.version ?? '0.0.0',
      main: pkg.main ?? 'index.js',
      inject: [],
      config,
      clientModulePath: dshBlock.client ? (dshBlock.client.inject as string[] | undefined)?.[0] : undefined,
      packageDir
    }

    // Dynamically import the ESM entry
    const entryPath = path.resolve(packageDir, descriptor.main)
    const entryUrl = pathToFileURL(entryPath).href
    console.log(`[DSH] Loading plugin ${descriptor.name} from ${entryUrl}`)
    const mod = await import(entryUrl) as Partial<DshPluginModule>

    if (!mod.name || !mod.apply) {
      console.error(`[DSH] Plugin ${descriptor.name} missing name/apply exports`)
      return null
    }

    descriptor.inject = mod.inject ?? []

    // Verify all injected services are available
    const availableServices = new Set(['webServer', 'sessions', 'workspaces'])
    for (const svc of descriptor.inject) {
      if (!availableServices.has(svc)) {
        console.error(`[DSH] Plugin ${descriptor.name} requires unavailable service: ${svc}`)
        return null
      }
    }

    // Call apply(ctx, config)
    try {
      mod.apply(this.ctx, config)
    } catch (err) {
      console.error(`[DSH] Plugin ${descriptor.name} apply() failed:`, err)
      return null
    }

    const loaded: LoadedPlugin = {
      descriptor,
      module: mod as DshPluginModule
    }
    this.loaded.set(descriptor.name, loaded)

    console.log(`[DSH] Plugin ${descriptor.name} v${descriptor.version} loaded successfully`)
    return descriptor.name
  }

  unloadPlugin(name: string): void {
    const plugin = this.loaded.get(name)
    if (!plugin) return
    try {
      // The plugin's effect() disposers are registered on the context;
      // disposing the context will clean them up. For individual unload,
      // we'd need per-plugin disposal — for now, just remove from registry.
    } catch (err) {
      console.warn(`[DSH] Error unloading ${name}:`, err)
    }
    this.loaded.delete(name)
  }

  listPlugins(): Array<{ name: string; version: string; packageDir: string }> {
    return [...this.loaded.values()].map((p) => ({
      name: p.descriptor.name,
      version: p.descriptor.version,
      packageDir: p.descriptor.packageDir
    }))
  }

  getPlugin(name: string): LoadedPlugin | undefined {
    return this.loaded.get(name)
  }

  /**
   * Parse cordis.patch.yml to extract the default config for the plugin.
   *
   * The YAML format is:
   *   - insert:
   *       - id: synapse
   *         name: dsh-synapse
   *         config:
   *           dataFile: !!js dshHomePath('synapse/workspaces.json')
   *           autoProjection: true
   *
   * DSH-specific `!!js` tags like `dshHomePath()` are translated to local
   * userData paths so the plugin persists data in the right location.
   */
  private parsePatchConfig(
    packageDir: string,
    _dshBlock: { bundle?: { patch?: string }; client?: { inject?: string[] } },
    pluginName: string
  ): DshPluginConfig {
    const patchPath = _dshBlock.bundle?.patch
    if (!patchPath) return {}

    const fullPath = path.resolve(packageDir, patchPath)
    if (!fs.existsSync(fullPath)) return {}

    const yaml = fs.readFileSync(fullPath, 'utf8')
    return this.extractConfig(yaml, pluginName)
  }

  private extractConfig(yaml: string, pluginName: string): DshPluginConfig {
    const config: DshPluginConfig = {}

    // Find the config: block (indented under a service definition)
    const configStart = yaml.indexOf('config:')
    if (configStart === -1) return config

    // Extract lines after config: that are more indented than the config: key
    const afterConfig = yaml.slice(configStart + 'config:'.length)
    const lines = afterConfig.split('\n')

    // Determine the config indentation from the first non-empty line
    let configIndent = -1
    for (const line of lines) {
      if (line.trim() === '') continue
      configIndent = line.length - line.trimStart().length
      break
    }
    if (configIndent === -1) return config

    for (const line of lines) {
      if (line.trim() === '') continue
      const indent = line.length - line.trimStart().length
      if (indent < configIndent) break // We've left the config block

      const trimmed = line.trim()
      const colonIdx = trimmed.indexOf(':')
      if (colonIdx === -1) continue

      const key = trimmed.slice(0, colonIdx).trim()
      const valueStr = trimmed.slice(colonIdx + 1).trim()

      if (valueStr === '') continue

      // Handle DSH-specific !!js tags
      if (valueStr.startsWith('!!js')) {
        // dshHomePath('synapse/workspaces.json') → userData/dsh-data/<plugin>/...
        const pathMatch = valueStr.match(/dshHomePath\(['"](.+?)['"]\)/)
        if (pathMatch) {
          const dataSubPath = pathMatch[1]
          config[key] = path.join(DATA_DIR, pluginName, dataSubPath)
        }
        continue
      }

      // Handle simple types
      if (valueStr === 'true') config[key] = true
      else if (valueStr === 'false') config[key] = false
      else if (valueStr === '[]') config[key] = []
      else if (valueStr === '{}') config[key] = {}
      else if (valueStr.startsWith('[') && valueStr.endsWith(']')) {
        // Simple array: ['a', 'b']
        const inner = valueStr.slice(1, -1).trim()
        if (inner === '') config[key] = []
        else config[key] = inner.split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
      } else if (valueStr.startsWith("'") && valueStr.endsWith("'")) {
        config[key] = valueStr.slice(1, -1)
      } else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
        config[key] = valueStr.slice(1, -1)
      } else {
        config[key] = valueStr
      }
    }

    return config
  }
}

export { PLUGINS_DIR, DATA_DIR }
