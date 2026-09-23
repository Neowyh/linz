import { unzipSync, strFromU8 } from 'fflate'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { resolveBundledPath } from '../resources'
import {
  getInstalledManifest,
  STAGING_DIR,
  PENDING_FILE
} from './update-checker'
import type { PatchManifest, ManifestFile, Manifest } from './types'

// ── 读取补丁包 manifest ─────────────────────────────────

/** 从 .linzpatch 文件中读取 patch-manifest.json */
export function readPatchManifest(zipPath: string): PatchManifest | null {
  try {
    const data = new Uint8Array(fs.readFileSync(zipPath))
    const entries = unzipSync(data)
    const manifestEntry = entries['patch-manifest.json']
    if (!manifestEntry) {
      console.error('[OfflinePatch] Missing patch-manifest.json in zip')
      return null
    }
    const raw = strFromU8(manifestEntry)
    const parsed = JSON.parse(raw)
    if (!parsed.fromVersion || !parsed.toVersion || !Array.isArray(parsed.files)) {
      console.error('[OfflinePatch] Invalid patch-manifest.json format')
      return null
    }
    return parsed as PatchManifest
  } catch (err) {
    console.error('[OfflinePatch] Failed to read patch manifest:', err)
    return null
  }
}

// ── 验证补丁包 ──────────────────────────────────────────

/** 验证离线补丁包是否可以安装
 *
 * 检查项：
 * 1. zip 文件可读，patch-manifest.json 存在且格式正确
 * 2. fromVersion 匹配本地已安装版本
 * 3. 补丁包中的文件在 zip 中实际存在
 */
export function validatePatchZip(
  zipPath: string
): { valid: true; manifest: PatchManifest } | { valid: false; error: string } {
  // 文件存在性检查
  if (!fs.existsSync(zipPath)) {
    return { valid: false, error: '补丁包文件不存在' }
  }

  // 读取补丁 manifest
  const patchManifest = readPatchManifest(zipPath)
  if (!patchManifest) {
    return { valid: false, error: '无法读取补丁包，文件可能已损坏' }
  }

  // 检查本地版本是否匹配
  const installedManifest = getInstalledManifest()
  if (!installedManifest) {
    return { valid: false, error: '无法读取本地版本信息' }
  }

  if (installedManifest.version === patchManifest.toVersion) {
    return { valid: false, error: `当前版本已是 v${patchManifest.toVersion}，无需更新` }
  }

  if (patchManifest.fromVersion === '*') {
    // 全量更新包：可从任意版本升级，但不应含 blockdiff（依赖旧文件重构）
    if (patchManifest.files.some((f) => f.type === 'blockdiff')) {
      return { valid: false, error: '全量更新包不应包含块级差分文件，请重新生成' }
    }
  } else if (installedManifest.version !== patchManifest.fromVersion) {
    return {
      valid: false,
      error: `版本不匹配：当前 v${installedManifest.version}，补丁包需要 v${patchManifest.fromVersion}`
    }
  }

  // 验证补丁包中的文件条目在 zip 内实际存在
  if (patchManifest.files.length === 0) {
    return { valid: false, error: '补丁包中没有变更文件' }
  }

  try {
    const data = new Uint8Array(fs.readFileSync(zipPath))
    const entries = unzipSync(data)
    for (const file of patchManifest.files) {
      if (file.type === 'blockdiff') {
        // 块级差分文件：验证 .blockdiff 条目存在
        const entryPath = `files/${file.path}.blockdiff`
        if (!entries[entryPath]) {
          return { valid: false, error: `补丁包中缺少差分数据: ${file.path}` }
        }
      } else {
        // 全量文件：验证文件存在且 SHA256 匹配
        const entryPath = `files/${file.path}`
        if (!entries[entryPath]) {
          return { valid: false, error: `补丁包中缺少文件: ${file.path}` }
        }
        const actualSha256 = sha256Hex(entries[entryPath])
        if (actualSha256 !== file.sha256) {
          return { valid: false, error: `文件校验失败: ${file.path}` }
        }
      }
    }
  } catch (err) {
    return { valid: false, error: `补丁包读取失败: ${String(err)}` }
  }

  return { valid: true, manifest: patchManifest }
}

// ── 提取补丁包 ──────────────────────────────────────────

/**
 * 提取离线补丁包到暂存目录并标记 pending。
 *
 * 流程：
 * 1. 解压补丁包到 STAGING_DIR
 * 2. 构建完整的新版本清单（合并未变更的文件 + 变更的文件）
 * 3. 写入 pending.json
 *
 * 调用方在提取成功后应重启应用，重启时 patch-applier
 * 会自动应用暂存文件。
 */
export async function extractPatchZip(
  zipPath: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // 验证补丁包
    const validation = validatePatchZip(zipPath)
    if (!validation.valid) {
      return { success: false, error: validation.error }
    }

    const patchManifest = validation.manifest

    // 读取补丁包内容
    const data = new Uint8Array(fs.readFileSync(zipPath))
    const entries = unzipSync(data)

    // 清理旧的暂存目录
    fs.rmSync(STAGING_DIR, { recursive: true, force: true })
    fs.mkdirSync(STAGING_DIR, { recursive: true })

    // 解压每个变更文件到暂存目录
    const stagedFiles: ManifestFile[] = []
    for (const file of patchManifest.files) {
      const stagingPath = path.join(STAGING_DIR, file.path)
      fs.mkdirSync(path.dirname(stagingPath), { recursive: true })

      if (file.type === 'blockdiff') {
        // 块级差分：从旧文件 + 变化块重构新文件
        const blockdiffEntry = entries[`files/${file.path}.blockdiff`]
        if (!blockdiffEntry) {
          return { success: false, error: `补丁包中缺少差分数据: ${file.path}` }
        }

        // 读取旧文件
        const oldFilePath = resolveBundledPath(file.path)
        if (!fs.existsSync(oldFilePath)) {
          return { success: false, error: `无法读取旧文件用于差分重构: ${file.path}` }
        }
        const oldData = fs.readFileSync(oldFilePath)

        // 重构新文件
        const reconstructed = reconstructFromBlockDiff(oldData, blockdiffEntry, file.blocks!)
        fs.writeFileSync(stagingPath, reconstructed)

        // 校验重构文件的 SHA256
        const actualSha256 = sha256Hex(new Uint8Array(reconstructed))
        if (actualSha256 !== file.sha256) {
          return { success: false, error: `差分重构校验失败: ${file.path}` }
        }

        console.log(`[OfflinePatch] Reconstructed blockdiff: ${file.path} (${(reconstructed.length / (1024 * 1024)).toFixed(1)}MB)`)
      } else {
        // 全量文件：直接从 zip 提取
        const entryPath = `files/${file.path}`
        const entryData = entries[entryPath]
        if (!entryData) {
          return { success: false, error: `补丁包中缺少文件: ${file.path}` }
        }
        fs.writeFileSync(stagingPath, Buffer.from(entryData))
      }

      // stagedFiles 只保留基本字段（去除 blockdiff 专用字段）
      stagedFiles.push({ path: file.path, sha256: file.sha256, size: file.size })
    }

    // 构建完整的新版本清单
    const newFiles: ManifestFile[] = []

    if (patchManifest.fromVersion === '*') {
      // 全量更新包：补丁包 files 即完整清单，直接使用
      // 去掉 type/blocks 等差分专用字段（installed-manifest.json 只需 path/sha256/size）
      for (const file of patchManifest.files) {
        newFiles.push({ path: file.path, sha256: file.sha256, size: file.size })
      }
    } else {
      // 差分补丁：读取本地旧清单，未变更的保留 + 变更的替换
      const installedManifest = getInstalledManifest()
      if (installedManifest) {
        const changedPaths = new Set(patchManifest.files.map((f) => f.path))
        const removedPaths = new Set(patchManifest.removed)
        for (const oldFile of installedManifest.files) {
          if (removedPaths.has(oldFile.path)) continue // 跳过已删除的文件
          if (changedPaths.has(oldFile.path)) continue // 跳过已变更的文件（稍后添加）
          newFiles.push(oldFile)
        }
      }
      // 添加变更的文件
      for (const file of patchManifest.files) {
        newFiles.push(file)
      }
    }

    // 排序（按路径）
    newFiles.sort((a, b) => a.path.localeCompare(b.path))

    const newManifest: Manifest = {
      version: patchManifest.toVersion,
      buildDate: new Date().toISOString(),
      files: newFiles
    }

    // 标记 pending
    // 我们复用 markPending 的逻辑，但直接构建 UpdateInfo
    // 实际上 markPending 需要 UpdateInfo，但我们可以直接写 pending.json
    // 因为 extractPatchZip 是离线补丁的入口，不走在线检查流程
    const pending = {
      version: patchManifest.toVersion,
      files: stagedFiles,
      manifest: newManifest,
      stagedAt: new Date().toISOString()
    }

    fs.mkdirSync(path.dirname(PENDING_FILE), { recursive: true })
    fs.writeFileSync(PENDING_FILE, JSON.stringify(pending, null, 2))

    console.log(`[OfflinePatch] Extracted ${stagedFiles.length} files, pending update to ${patchManifest.toVersion}`)
    return { success: true }

  } catch (err) {
    console.error('[OfflinePatch] Failed to extract patch:', err)
    return { success: false, error: String(err) }
  }
}

// ── 工具函数 ──────────────────────────────────────────────

/** 计算 Buffer 的 SHA256 */
function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

/**
 * 从旧文件和块级差分数据重构新文件。
 *
 * 遍历块映射表，对每个块：
 * - changed: false → 从旧文件对应 offset 复制 size 字节
 * - changed: true  → 从 blockdiffData 顺序读取 size 字节
 * 拼接所有块即为完整的新文件。
 */
function reconstructFromBlockDiff(
  oldData: Buffer,
  blockdiffData: Uint8Array,
  blocks: Array<{ offset: number; size: number; sha256: string; changed: boolean }>
): Buffer {
  const chunks: Buffer[] = []
  let diffReadPos = 0

  for (const block of blocks) {
    if (block.changed) {
      // 从差分数据中读取
      const end = Math.min(diffReadPos + block.size, blockdiffData.length)
      chunks.push(Buffer.from(blockdiffData.subarray(diffReadPos, end)))
      diffReadPos = end
    } else {
      // 从旧文件中读取
      const end = Math.min(block.offset + block.size, oldData.length)
      chunks.push(Buffer.from(oldData.subarray(block.offset, end)))
    }
  }

  return Buffer.concat(chunks)
}