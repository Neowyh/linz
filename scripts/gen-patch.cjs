// 生成离线补丁包（.linzpatch 文件）。
// 对比旧版和新版 manifest，将变更的文件打包为一个 zip。
//
// 大文件（≥ diff-threshold）使用块级差分（blockdiff），
// 只打包变化的块 + 块映射表，大幅减少补丁体积。
// 小文件直接全量包含（full）。
//
// 用法：
//   全量包：node scripts/gen-patch.cjs --new manifest.json
//   差分包：node scripts/gen-patch.cjs --old manifest-1.0.0.json --new manifest.json --old-resources-dir dist/old-1.0.0/resources
//
// 未指定 --output 时按版本号自动生成文件名：
//   全量包 → update-full-{version}.linzpatch
//   差分包 → patch-{fromVersion}-to-{toVersion}.linzpatch
//
// 可选参数：
//   --output <file>                               （输出文件名，不指定则自动按版本号生成）
//   --old-resources-dir dist/old-build/resources  （旧版构建的 resources 目录，用于块级差分）
//   --resources-dir dist/win-unpacked/resources    （新版构建的 resources 目录，默认值同左）
//   --block-size 262144                            （块大小，默认 256KB）
//   --diff-threshold 5242880                       （差分阈值，默认 5MB，小于此值用全量）

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

let fflate
try {
  fflate = require('fflate')
} catch {
  console.error('[gen-patch] fflate 未安装，请运行 npm install')
  process.exit(1)
}

const { zipSync, strToU8 } = fflate

const DEFAULT_BLOCK_SIZE = 262144       // 256 KB
const DEFAULT_DIFF_THRESHOLD = 5242880  // 5 MB

// ── 命令行参数解析 ──────────────────────────────────────

function parseArgs(argv) {
  const args = {}
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const eqIdx = key.indexOf('=')
      if (eqIdx >= 0) {
        args[key.slice(0, eqIdx)] = key.slice(eqIdx + 1)
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[key] = argv[++i]
      } else {
        args[key] = true
      }
    }
  }
  return args
}

// ── SHA256 辅助 ──────────────────────────────────────────

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

// ── 块级差分生成 ────────────────────────────────────────

/**
 * 对比旧文件和新文件，生成块级差分。
 *
 * @param {Buffer} oldData 旧文件数据
 * @param {Buffer} newData 新文件数据
 * @param {number} blockSize 块大小
 * @returns {{ blocks: Array, blockdiffData: Buffer }}
 */
function generateBlockDiff(oldData, newData, blockSize) {
  const blocks = []
  const changedChunks = []

  const blockCount = Math.ceil(newData.length / blockSize)

  for (let i = 0; i < blockCount; i++) {
    const offset = i * blockSize
    const end = Math.min(offset + blockSize, newData.length)
    const size = end - offset
    const newBlock = newData.subarray(offset, end)
    const newHash = sha256(newBlock)

    // 检查旧文件是否有相同偏移量和大小的块
    let changed = true
    if (offset + size <= oldData.length) {
      const oldBlock = oldData.subarray(offset, offset + size)
      const oldHash = sha256(oldBlock)
      changed = oldHash !== newHash
    }
    // 旧文件太短或没有对应块 → changed = true

    blocks.push({ offset, size, sha256: newHash, changed })

    if (changed) {
      changedChunks.push(Buffer.from(newBlock))
    }
  }

  return { blocks, blockdiffData: Buffer.concat(changedChunks) }
}

// ── 主逻辑 ──────────────────────────────────────────────

function main() {
  const args = parseArgs(process.argv)

  const oldManifestPath = args.old
  const newManifestPath = args.new
  let outputPath = args.output
  const resourcesDir = args['resources-dir'] || path.join('dist', 'win-unpacked', 'resources')
  const oldResourcesDir = args['old-resources-dir'] || ''
  const blockSize = parseInt(args['block-size'] || String(DEFAULT_BLOCK_SIZE), 10)
  const diffThreshold = parseInt(args['diff-threshold'] || String(DEFAULT_DIFF_THRESHOLD), 10)

  const fullMode = !oldManifestPath || args.full === true

  if (!newManifestPath) {
    console.error('[gen-patch] 用法:')
    console.error('[gen-patch]   全量包: node scripts/gen-patch.cjs --new <manifest.json> [--output <file>]')
    console.error('[gen-patch]   差分包: node scripts/gen-patch.cjs --old <manifest.json> --new <manifest.json> --old-resources-dir <path> [--output <file>]')
    console.error('[gen-patch] 未指定 --output 时按版本号自动生成文件名')
    process.exit(1)
  }

  const ROOT = path.resolve(__dirname, '..')
  const newManifestFull = path.resolve(ROOT, newManifestPath)
  const resourcesFull = path.resolve(ROOT, resourcesDir)
  const oldResourcesFull = oldResourcesDir ? path.resolve(ROOT, oldResourcesDir) : ''

  // 读取新版 manifest
  if (!fs.existsSync(newManifestFull)) {
    console.error('[gen-patch] 新版 manifest 未找到:', newManifestFull)
    process.exit(1)
  }
  const newManifest = JSON.parse(fs.readFileSync(newManifestFull, 'utf8'))

  // 全量模式：所有文件以 full 类型打包，fromVersion="*"，可从任意版本升级
  // 差分模式：对比新旧 manifest，只打包变更文件（大文件块级差分）
  let oldManifest = null
  if (!fullMode) {
    const oldManifestFull = path.resolve(ROOT, oldManifestPath)
    if (!fs.existsSync(oldManifestFull)) {
      console.error('[gen-patch] 旧版 manifest 未找到:', oldManifestFull)
      process.exit(1)
    }
    oldManifest = JSON.parse(fs.readFileSync(oldManifestFull, 'utf8'))
  }

  // 未指定 --output 时，按版本号自动生成文件名
  if (!outputPath) {
    outputPath = fullMode
      ? `update-full-${newManifest.version}.linzpatch`
      : `patch-${oldManifest.version}-to-${newManifest.version}.linzpatch`
  }
  const outputFull = path.resolve(ROOT, outputPath)

  if (fullMode) {
    console.log('[gen-patch] 模式: 全量更新包（fromVersion=*，可从任意版本升级）')
  } else {
    console.log('[gen-patch] 模式: 差分补丁包（fromVersion=' + oldManifest.version + '）')
    console.log('[gen-patch] 旧版:', oldManifest.version, `(${oldManifest.files.length} 文件)`)
  }
  console.log('[gen-patch] 新版:', newManifest.version, `(${newManifest.files.length} 文件)`)
  console.log('[gen-patch] 块大小:', (blockSize / 1024).toFixed(0), 'KB, 差分阈值:', (diffThreshold / (1024 * 1024)).toFixed(0), 'MB')
  if (!fullMode && oldResourcesFull) {
    console.log('[gen-patch] 旧版 resources:', oldResourcesFull)
  } else if (!fullMode) {
    console.log('[gen-patch] 未指定 --old-resources-dir，所有文件使用全量模式')
  }

  let changedFiles = []
  let removedFiles = []

  if (fullMode) {
    // 全量模式：所有文件都打包
    changedFiles = newManifest.files.slice()
    removedFiles = []
  } else {
    // 差分模式：对比新旧文件，找出变更和新增
    const oldFileMap = new Map()
    for (const f of oldManifest.files) {
      oldFileMap.set(f.path, f)
    }

    for (const newFile of newManifest.files) {
      const oldFile = oldFileMap.get(newFile.path)
      if (!oldFile) {
        changedFiles.push(newFile)
      } else if (oldFile.sha256 !== newFile.sha256) {
        changedFiles.push(newFile)
      }
    }

    const newFileSet = new Set(newManifest.files.map(f => f.path))
    for (const oldFile of oldManifest.files) {
      if (!newFileSet.has(oldFile.path)) {
        removedFiles.push(oldFile.path)
      }
    }
  }

  console.log(`[gen-patch] 变更: ${changedFiles.length} 文件, 删除: ${removedFiles.length} 文件`)

  if (changedFiles.length === 0 && removedFiles.length === 0) {
    console.log('[gen-patch] 两个版本完全相同，无需生成补丁包')
    process.exit(0)
  }

  // 构建补丁包内容
  const zipData = {}
  const patchFiles = []
  let fullCount = 0
  let diffCount = 0
  let fullSize = 0
  let diffOriginalSize = 0
  let diffPatchSize = 0

  for (const file of changedFiles) {
    const newFilePath = path.join(resourcesFull, file.path)
    if (!fs.existsSync(newFilePath)) {
      console.warn(`[gen-patch] 警告: 文件未找到, 跳过: ${file.path}`)
      continue
    }

    const newFileSize = fs.statSync(newFilePath).size
    const oldFilePath = oldResourcesFull ? path.join(oldResourcesFull, file.path) : ''
    const oldFileExists = oldFilePath && fs.existsSync(oldFilePath)

    // 判断是否使用块级差分
    const useBlockDiff = oldFileExists && newFileSize >= diffThreshold

    if (useBlockDiff) {
      // 块级差分
      const oldData = fs.readFileSync(oldFilePath)
      const newData = fs.readFileSync(newFilePath)
      const { blocks, blockdiffData } = generateBlockDiff(oldData, newData, blockSize)

      // 添加块差分数据到 zip
      zipData[`files/${file.path}.blockdiff`] = new Uint8Array(blockdiffData)

      // manifest 条目
      patchFiles.push({
        path: file.path,
        sha256: file.sha256,
        size: file.size,
        type: 'blockdiff',
        blockSize,
        blocks
      })

      diffCount++
      diffOriginalSize += newFileSize
      diffPatchSize += blockdiffData.length
      const savedMB = ((newFileSize - blockdiffData.length) / (1024 * 1024)).toFixed(1)
      const changedBlocks = blocks.filter(b => b.changed).length
      console.log(`[gen-patch] 差分: ${file.path} (${(newFileSize / (1024 * 1024)).toFixed(1)}MB → ${(blockdiffData.length / (1024 * 1024)).toFixed(1)}MB, ${changedBlocks}/${blocks.length} 块变化)`)
    } else {
      // 全量包含
      const content = fs.readFileSync(newFilePath)
      zipData[`files/${file.path}`] = new Uint8Array(content)

      patchFiles.push({
        path: file.path,
        sha256: file.sha256,
        size: file.size,
        type: 'full'
      })

      fullCount++
      fullSize += newFileSize
    }
  }

  // 添加 patch-manifest.json
  const patchManifest = {
    fromVersion: fullMode ? '*' : oldManifest.version,
    toVersion: newManifest.version,
    createdAt: new Date().toISOString(),
    files: patchFiles,
    removed: removedFiles
  }
  zipData['patch-manifest.json'] = strToU8(JSON.stringify(patchManifest, null, 2))

  // 生成 zip
  const zipped = zipSync(zipData)

  // 写入输出文件
  fs.writeFileSync(outputFull, Buffer.from(zipped))

  // 统计信息
  console.log('')
  console.log('[gen-patch] ── 统计 ──────────────────────────────')
  console.log(`[gen-patch] 全量文件: ${fullCount} 个 (${(fullSize / (1024 * 1024)).toFixed(1)} MB)`)
  console.log(`[gen-patch] 差分文件: ${diffCount} 个`)
  if (diffCount > 0) {
    console.log(`[gen-patch]   原始大小: ${(diffOriginalSize / (1024 * 1024)).toFixed(1)} MB`)
    console.log(`[gen-patch]   差分大小: ${(diffPatchSize / (1024 * 1024)).toFixed(1)} MB`)
    console.log(`[gen-patch]   压缩率: ${((1 - diffPatchSize / diffOriginalSize) * 100).toFixed(1)}%`)
  }
  console.log(`[gen-patch] 补丁包大小: ${(zipped.length / (1024 * 1024)).toFixed(1)} MB (压缩后)`)
  console.log(`[gen-patch] 写入: ${outputFull}`)
  console.log('[gen-patch] 完成。')
}

main()
