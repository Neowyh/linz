// 构建后生成版本清单（manifest.json + installed-manifest.json）。
// 扫描 dist/win-unpacked/resources/ 下的可更新文件，计算 SHA256 + 大小。
// 用法：先 npm run build 或 npm run pack，再 node scripts/gen-manifest.cjs
//
// 生成两份文件：
//  1. manifest.json          — 上传到更新服务器（供客户端比对）
//  2. resources/installed-manifest.json — 嵌入安装包（记录初始已安装版本）
//
// 路径格式：相对于 resources/（如 "app.asar"、"dsh-plugins/dsh-synapse/index.js"），
// 与 src/main/resources.ts 的 resolveBundledPath() 一致。
//
// 排除 resources/bin/（Python/pandoc/poppler，太大且极少变更，走完整包更新）

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

const ROOT = path.resolve(__dirname, '..')
const WIN_UNPACKED = path.join(ROOT, 'dist', 'win-unpacked')
const RESOURCES_DIR = path.join(WIN_UNPACKED, 'resources')

// 排除的目录/文件（不参与补丁更新）
const EXCLUDE_DIRS = ['bin']

function computeSha256(filePath) {
  const hash = crypto.createHash('sha256')
  const data = fs.readFileSync(filePath)
  return hash.update(data).digest('hex')
}

function walkDir(dir, baseDir, files) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    // 跳过排除的目录
    if (entry.isDirectory() && EXCLUDE_DIRS.includes(entry.name)) continue
    // 跳过 installed-manifest.json 自身（避免自引用）
    if (entry.name === 'installed-manifest.json') continue

    if (entry.isDirectory()) {
      walkDir(fullPath, baseDir, files)
    } else {
      const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/')
      const sha256 = computeSha256(fullPath)
      const size = fs.statSync(fullPath).size
      files.push({ path: relPath, sha256, size })
    }
  }
}

function main() {
  if (!fs.existsSync(RESOURCES_DIR)) {
    console.error('[gen-manifest] resources/ directory not found at', RESOURCES_DIR)
    console.error('[gen-manifest] Please run "npm run build" or "npm run pack" first.')
    process.exit(1)
  }

  // 读取 package.json 获取版本号
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const version = pkg.version
  const buildDate = new Date().toISOString()

  console.log('[gen-manifest] Scanning', RESOURCES_DIR)
  console.log('[gen-manifest] Version:', version)
  console.log('[gen-manifest] Excluded dirs:', EXCLUDE_DIRS.join(', '))

  const files = []
  walkDir(RESOURCES_DIR, RESOURCES_DIR, files)

  // 按路径排序，确保 manifest 稳定
  files.sort((a, b) => a.path.localeCompare(b.path))

  const manifest = {
    version,
    buildDate,
    files
  }

  // 写出 manifest.json（项目根目录，供上传到服务器）
  const manifestPath = path.join(ROOT, 'manifest.json')
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log('[gen-manifest] Wrote', manifestPath, `(${files.length} files)`)

  // 写出 installed-manifest.json 到源 resources/ 目录（供 electron-builder extraResources 打包）
  const sourceResourcesDir = path.join(ROOT, 'resources')
  const sourceManifestPath = path.join(sourceResourcesDir, 'installed-manifest.json')
  fs.writeFileSync(sourceManifestPath, JSON.stringify(manifest, null, 2))
  console.log('[gen-manifest] Wrote', sourceManifestPath)

  // 也写入 dist/win-unpacked/resources/（供即时测试，无需重新打包）
  if (fs.existsSync(RESOURCES_DIR)) {
    const distManifestPath = path.join(RESOURCES_DIR, 'installed-manifest.json')
    fs.writeFileSync(distManifestPath, JSON.stringify(manifest, null, 2))
    console.log('[gen-manifest] Wrote', distManifestPath)
  }

  // 打印统计信息
  const totalSize = files.reduce((sum, f) => sum + f.size, 0)
  const fmtSize = (bytes) => {
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
  }
  console.log('[gen-manifest] Total patchable size:', fmtSize(totalSize))
  console.log('[gen-manifest] Done.')
}

main()
