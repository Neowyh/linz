import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { app } from 'electron'
import { resolveBundledPath } from '../resources'
import {
  hasPendingUpdate,
  getPendingUpdate,
  clearPending,
  STAGING_DIR,
  BACKUP_DIR
} from './update-checker'
import type { PendingUpdate, ManifestFile } from './types'

/**
 * 在应用启动早期（窗口创建之前）应用暂存的更新。
 *
 * 流程：读取 pending.json → 对每个暂存文件执行
 * 备份旧文件 → 替换为新文件 → 校验 SHA256 →
 * 全部成功则更新 installed-manifest.json 并清理暂存目录；
 * 任何步骤失败则从备份回滚。
 *
 * @returns true 如果应用了更新，false 如果没有待应用的更新
 */
export async function applyPendingUpdate(): Promise<boolean> {
  if (!hasPendingUpdate()) return false

  const pending = getPendingUpdate()
  if (!pending) return false

  console.log(`[Updater] Applying pending update to version ${pending.version} (${pending.files.length} files)`)

  // 清理旧的备份目录
  fs.rmSync(BACKUP_DIR, { recursive: true, force: true })
  fs.mkdirSync(BACKUP_DIR, { recursive: true })

  const appliedFiles: ManifestFile[] = []

  try {
    for (const file of pending.files) {
      const stagingPath = path.join(STAGING_DIR, file.path)
      const targetPath = resolveBundledPath(file.path)
      const backupPath = path.join(BACKUP_DIR, file.path)

      // 检查暂存文件是否存在
      if (!fs.existsSync(stagingPath)) {
        throw new Error(`Staged file not found: ${file.path}`)
      }

      // 备份当前文件（如果存在）
      if (fs.existsSync(targetPath)) {
        fs.mkdirSync(path.dirname(backupPath), { recursive: true })
        fs.copyFileSync(targetPath, backupPath)
      }

      // 替换为目标文件
      fs.mkdirSync(path.dirname(targetPath), { recursive: true })
      fs.copyFileSync(stagingPath, targetPath)

      // 校验 SHA256
      const actualSha256 = computeFileSha256(targetPath)
      if (actualSha256 !== file.sha256) {
        throw new Error(`SHA256 mismatch after copy: ${file.path} (expected ${file.sha256}, got ${actualSha256})`)
      }

      appliedFiles.push(file)
      console.log(`[Updater] Applied: ${file.path}`)
    }

    // 全部成功 — 更新 installed-manifest.json
    const manifestPath = resolveBundledPath('installed-manifest.json')
    if (pending.manifest) {
      fs.writeFileSync(manifestPath, JSON.stringify(pending.manifest, null, 2))
      console.log(`[Updater] Updated installed-manifest.json to version ${pending.manifest.version}`)
    }

    // 清理
    clearPending()
    fs.rmSync(STAGING_DIR, { recursive: true, force: true })
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true })

    console.log(`[Updater] Update to ${pending.version} applied successfully`)
    return true

  } catch (err) {
    console.error('[Updater] Failed to apply update, rolling back:', err)

    // 回滚已应用的文件
    for (const file of appliedFiles) {
      try {
        const targetPath = resolveBundledPath(file.path)
        const backupPath = path.join(BACKUP_DIR, file.path)
        if (fs.existsSync(backupPath)) {
          fs.copyFileSync(backupPath, targetPath)
          console.log(`[Updater] Rolled back: ${file.path}`)
        }
      } catch (rollbackErr) {
        console.error(`[Updater] Rollback failed for ${file.path}:`, rollbackErr)
      }
    }

    // 回滚未应用但有备份的文件
    try {
      restoreAllBackups()
    } catch (rollbackErr) {
      console.error('[Updater] Full rollback error:', rollbackErr)
    }

    // 清理备份但不清理暂存（用户可以重试）
    fs.rmSync(BACKUP_DIR, { recursive: true, force: true })

    // 清除 pending 标记（避免反复失败）
    clearPending()
    fs.rmSync(STAGING_DIR, { recursive: true, force: true })

    return false
  }
}

/** 从备份目录恢复所有文件 */
function restoreAllBackups(): void {
  if (!fs.existsSync(BACKUP_DIR)) return

  const restoreDir = (dir: string): void => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        restoreDir(fullPath)
      } else {
        // 计算相对于 BACKUP_DIR 的路径，然后映射到目标位置
        const relPath = path.relative(BACKUP_DIR, fullPath)
        const targetPath = resolveBundledPath(relPath)
        fs.mkdirSync(path.dirname(targetPath), { recursive: true })
        fs.copyFileSync(fullPath, targetPath)
      }
    }
  }

  restoreDir(BACKUP_DIR)
}

/** 计算文件 SHA256（十六进制小写） */
function computeFileSha256(filePath: string): string {
  const hash = createHash('sha256')
  const data = fs.readFileSync(filePath)
  return hash.update(data).digest('hex')
}
