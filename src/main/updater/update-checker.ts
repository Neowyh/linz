import https from 'node:https'
import http from 'node:http'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { resolveBundledPath } from '../resources'
import type { Manifest, ManifestFile, UpdateInfo, DownloadProgress, PendingUpdate } from './types'

// ── 路径常量 ──────────────────────────────────────────────
const UPDATES_DIR = path.join(app.getPath('userData'), 'updates')
const STAGING_DIR = path.join(UPDATES_DIR, 'staging')
const BACKUP_DIR = path.join(UPDATES_DIR, 'backup')
const PENDING_FILE = path.join(UPDATES_DIR, 'pending.json')

// ── 工具函数 ──────────────────────────────────────────────

/** 计算文件 SHA256（十六进制小写） */
function computeFileSha256(filePath: string): string {
  const hash = createHash('sha256')
  const data = fs.readFileSync(filePath)
  return hash.update(data).digest('hex')
}

/** 格式化字节数为可读字符串 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// ── 本地清单 ──────────────────────────────────────────────

/** 读取嵌入安装包的本地版本清单 */
export function getInstalledManifest(): Manifest | null {
  const manifestPath = resolveBundledPath('installed-manifest.json')
  if (!fs.existsSync(manifestPath)) {
    console.warn('[Updater] installed-manifest.json not found at', manifestPath)
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
  } catch (err) {
    console.error('[Updater] Failed to parse installed manifest:', err)
    return null
  }
}

/** 获取当前已安装版本号 */
export function getCurrentVersion(): string {
  return getInstalledManifest()?.version ?? app.getVersion() ?? '0.0.0'
}

// ── 远程清单获取 ──────────────────────────────────────────

/** HTTPS/HTTP GET，跟随 3xx 重定向，返回响应体 Buffer */
function httpGet(url: string, maxRedirects = 5): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http
    const req = lib.get(url, { timeout: 30000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        if (maxRedirects <= 0) {
          reject(new Error('Too many redirects'))
          return
        }
        const redirectUrl = new URL(res.headers.location, url).href
        httpGet(redirectUrl, maxRedirects - 1).then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      const chunks: Buffer[] = []
      res.on('data', (chunk: Buffer) => chunks.push(chunk))
      res.on('end', () => resolve(Buffer.concat(chunks)))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error('Request timeout'))
    })
  })
}

/** 从远程服务器获取版本清单 */
export async function fetchRemoteManifest(serverUrl: string): Promise<Manifest> {
  const url = `${serverUrl.replace(/\/$/, '')}/manifest.json`
  console.log('[Updater] Fetching remote manifest from', url)
  const buf = await httpGet(url)
  const manifest = JSON.parse(buf.toString('utf8'))
  if (!manifest.version || !Array.isArray(manifest.files)) {
    throw new Error('Invalid manifest format: missing version or files')
  }
  return manifest
}

// ── 清单比对 ──────────────────────────────────────────────

/** 比对本地和远程清单，返回需要下载的文件列表 */
export function diffManifests(local: Manifest, remote: Manifest): ManifestFile[] {
  const localMap = new Map(local.files.map((f) => [f.path, f]))
  const changed: ManifestFile[] = []

  for (const remoteFile of remote.files) {
    const localFile = localMap.get(remoteFile.path)
    if (!localFile || localFile.sha256 !== remoteFile.sha256) {
      changed.push(remoteFile)
    }
  }

  return changed
}

// ── 检查更新 ──────────────────────────────────────────────

/** 检查是否有可用更新 */
export async function checkForUpdates(serverUrl: string): Promise<UpdateInfo | null> {
  if (!serverUrl) return null

  const local = getInstalledManifest()
  if (!local) {
    console.warn('[Updater] No local manifest, cannot check for updates')
    return null
  }

  const remote = await fetchRemoteManifest(serverUrl)

  if (remote.version === local.version) {
    console.log('[Updater] Already up to date:', local.version)
    return null
  }

  const changed = diffManifests(local, remote)
  if (changed.length === 0) {
    console.log('[Updater] Version differs but no files changed — skipping')
    return null
  }

  const totalDownloadSize = changed.reduce((sum, f) => sum + f.size, 0)
  console.log(`[Updater] ${changed.length} files changed, ${formatBytes(totalDownloadSize)} to download`)

  // 缓存完整远程清单，markPending 时读取
  fs.mkdirSync(UPDATES_DIR, { recursive: true })
  fs.writeFileSync(path.join(UPDATES_DIR, 'remote-manifest.json'), JSON.stringify(remote, null, 2))

  return {
    currentVersion: local.version,
    latestVersion: remote.version,
    changelog: remote.changelog,
    totalDownloadSize,
    files: changed
  }
}

// ── 下载更新 ──────────────────────────────────────────────

/** 下载单个文件到暂存目录，校验 SHA256 */
async function downloadFile(
  serverUrl: string,
  version: string,
  file: ManifestFile,
  onProgress?: (downloaded: number, total: number) => void
): Promise<void> {
  const downloadUrl = `${serverUrl.replace(/\/$/, '')}/files/${version}/${file.path}`
  const stagingPath = path.join(STAGING_DIR, file.path)

  // 确保目录存在
  fs.mkdirSync(path.dirname(stagingPath), { recursive: true })

  return new Promise((resolve, reject) => {
    const lib = downloadUrl.startsWith('https') ? https : http
    const req = lib.get(downloadUrl, { timeout: 120000 }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        const redirectUrl = new URL(res.headers.location, downloadUrl).href
        downloadFile(redirectUrl.replace(/^https?:\/\/[^/]+/, serverUrl.replace(/\/$/, '')), version, file, onProgress)
          .then(resolve).catch(reject)
        return
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Failed to download ${file.path}: HTTP ${res.statusCode}`))
        return
      }

      const hash = createHash('sha256')
      const writeStream = fs.createWriteStream(stagingPath)
      let downloaded = 0

      res.on('data', (chunk: Buffer) => {
        hash.update(chunk)
        downloaded += chunk.length
        onProgress?.(downloaded, file.size)
      })

      res.pipe(writeStream)

      writeStream.on('finish', () => {
        writeStream.close()
        const sha256 = hash.digest('hex')
        if (sha256 !== file.sha256) {
          fs.unlinkSync(stagingPath)
          reject(new Error(`SHA256 mismatch for ${file.path}: expected ${file.sha256}, got ${sha256}`))
          return
        }
        resolve()
      })

      writeStream.on('error', reject)
    })

    req.on('error', reject)
    req.on('timeout', () => {
      req.destroy()
      reject(new Error(`Download timeout for ${file.path}`))
    })
  })
}

/** 下载所有变更文件到暂存目录 */
export async function downloadUpdate(
  serverUrl: string,
  info: UpdateInfo,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  const statePath = path.join(UPDATES_DIR, 'download-state.json')

  // 断点续传：检查是否有相同版本的未完成下载
  let prevVersion = ''
  try {
    const state = JSON.parse(fs.readFileSync(statePath, 'utf8'))
    prevVersion = state.version || ''
  } catch { /* 无状态文件，全新下载 */ }

  // 版本不同 → 清理暂存目录重新开始；版本相同 → 保留已下载文件
  if (prevVersion !== info.latestVersion) {
    fs.rmSync(STAGING_DIR, { recursive: true, force: true })
  }
  fs.mkdirSync(STAGING_DIR, { recursive: true })

  // 记录当前下载版本（中断后可用于判断是否续传）
  fs.writeFileSync(statePath, JSON.stringify({ version: info.latestVersion }))

  const totalSize = info.totalDownloadSize
  let totalDownloaded = 0

  for (let i = 0; i < info.files.length; i++) {
    const file = info.files[i]
    const stagingPath = path.join(STAGING_DIR, file.path)

    // 检查文件是否已下载且校验通过（断点续传跳过）
    if (fs.existsSync(stagingPath)) {
      const actualSha256 = computeFileSha256(stagingPath)
      if (actualSha256 === file.sha256) {
        console.log(`[Updater] Skipping (already downloaded): ${file.path}`)
        totalDownloaded += file.size
        onProgress?.({
          fileName: file.path,
          downloaded: file.size,
          total: file.size,
          fileIndex: i,
          fileCount: info.files.length,
          totalDownloaded,
          totalSize
        })
        continue
      }
      // SHA256 不匹配 → 文件损坏，删除后重新下载
      fs.unlinkSync(stagingPath)
    }

    console.log(`[Updater] Downloading ${i + 1}/${info.files.length}: ${file.path} (${formatBytes(file.size)})`)

    await downloadFile(serverUrl, info.latestVersion, file, (downloaded, total) => {
      onProgress?.({
        fileName: file.path,
        downloaded,
        total,
        fileIndex: i,
        fileCount: info.files.length,
        totalDownloaded: totalDownloaded + downloaded,
        totalSize
      })
    })

    totalDownloaded += file.size
  }

  // 下载完成，清理状态文件
  try { fs.unlinkSync(statePath) } catch { /* 忽略 */ }

  console.log('[Updater] All files downloaded and verified')
}

// ── 暂存标记管理 ──────────────────────────────────────────

/** 写入 pending.json 标记，表示暂存更新待应用 */
export function markPending(info: UpdateInfo): void {
  // 读取 checkForUpdates 缓存的完整远程清单
  const manifestPath = path.join(UPDATES_DIR, 'remote-manifest.json')
  let manifest: Manifest | null = null
  if (fs.existsSync(manifestPath)) {
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
    } catch (err) {
      console.error('[Updater] Failed to read cached remote manifest:', err)
    }
  }

  const pending: PendingUpdate = {
    version: info.latestVersion,
    files: info.files,
    manifest: manifest ?? {
      version: info.latestVersion,
      buildDate: new Date().toISOString(),
      files: info.files
    },
    stagedAt: new Date().toISOString()
  }
  fs.mkdirSync(UPDATES_DIR, { recursive: true })
  fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2))
  console.log(`[Updater] Marked pending update to version ${pending.version}`)
}

/** 是否有待应用的暂存更新 */
export function hasPendingUpdate(): boolean {
  return fs.existsSync(PENDING_FILE)
}

/** 读取待应用的暂存更新信息 */
export function getPendingUpdate(): PendingUpdate | null {
  if (!fs.existsSync(PENDING_FILE)) return null
  try {
    return JSON.parse(fs.readFileSync(PENDING_FILE, 'utf8'))
  } catch (err) {
    console.error('[Updater] Failed to parse pending update:', err)
    return null
  }
}

/** 清除 pending 标记 */
export function clearPending(): void {
  if (fs.existsSync(PENDING_FILE)) {
    fs.unlinkSync(PENDING_FILE)
  }
}

// ── 目录路径导出（供 patch-applier 使用）─────────────────

export { STAGING_DIR, BACKUP_DIR, UPDATES_DIR, PENDING_FILE }
