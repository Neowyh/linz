// 补丁式更新系统的共享类型定义。
// manifest.json 描述每个版本的可更新文件清单（路径相对于 resources/），
// patch-applier 和 update-checker 都基于此清单进行比对和替换。

/** 版本清单中的单个文件条目 */
export interface ManifestFile {
  /** 相对于 resources/ 的路径，如 "app.asar"、"dsh-plugins/dsh-synapse/index.js" */
  path: string
  /** 文件 SHA256 哈希（十六进制小写） */
  sha256: string
  /** 文件字节数 */
  size: number
  /** 补丁包专用：文件类型（full=完整文件，blockdiff=块级差分）。无此字段视为 full */
  type?: 'full' | 'blockdiff'
  /** blockdiff 专用：块大小（字节） */
  blockSize?: number
  /** blockdiff 专用：块映射表，描述每个块是来自旧文件还是补丁数据 */
  blocks?: BlockEntry[]
}

/** 块级差分中的单个块条目 */
export interface BlockEntry {
  /** 块在新文件中的偏移量（字节） */
  offset: number
  /** 块大小（字节） */
  size: number
  /** 块的 SHA256（十六进制小写） */
  sha256: string
  /** true=块已变化，数据在 .blockdiff 文件中；false=块未变，从旧文件复制 */
  changed: boolean
}

/** 完整版本清单 — 构建时生成，嵌入安装包并上传到更新服务器 */
export interface Manifest {
  version: string
  buildDate: string
  files: ManifestFile[]
  /** 变更日志（可选，由服务器 manifest 提供） */
  changelog?: string
}

/** 检查更新后返回的信息 */
export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  /** 变更日志（可选，由服务器 manifest 提供） */
  changelog?: string
  /** 需要下载的文件总字节数 */
  totalDownloadSize: number
  /** 需要下载的文件列表 */
  files: ManifestFile[]
}

/** 更新流程状态 */
export type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

/** 下载进度回调数据 */
export interface DownloadProgress {
  /** 当前正在下载的文件名 */
  fileName: string
  /** 已下载字节数 */
  downloaded: number
  /** 当前文件总字节数 */
  total: number
  /** 当前文件索引（从 0 开始） */
  fileIndex: number
  /** 文件总数 */
  fileCount: number
  /** 所有文件累计已下载字节数 */
  totalDownloaded: number
  /** 所有文件累计总字节数 */
  totalSize: number
}

/** pending.json — 暂存更新待应用标记 */
export interface PendingUpdate {
  version: string
  /** 需要应用的变更文件列表（仅变更的文件） */
  files: ManifestFile[]
  /** 完整的新版本清单（用于替换 installed-manifest.json） */
  manifest: Manifest
  stagedAt: string
}

/** 离线补丁包（.linzpatch）的 manifest */
export interface PatchManifest {
  /** 补丁包源版本。值为 "*" 时表示全量更新包，可从任意版本升级（包内文件均为 full 类型） */
  fromVersion: string
  toVersion: string
  createdAt: string
  /** 变更的文件列表 */
  files: ManifestFile[]
  /** 已删除的文件路径列表 */
  removed: string[]
}
