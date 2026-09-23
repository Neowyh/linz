# 临智 LINZ 补丁式更新系统设计方案

> 状态：设计阶段 | 日期：2026-09-02

## 1. 背景与目标

当前应用每次发版都需要重新分发完整的 NSIS 安装包（~1.4 GB），其中 70% 的体积（Python 406MB + pandoc 223MB + Electron 运行时 157MB）几乎永远不变。用户需要反复下载和安装大包，效率极低。

**目标**：建立补丁式更新系统，支持两种模式：
- **在线自动更新**：应用启动时检查远程服务器，只下载变化的文件，完成后提示重启
- **离线补丁包**：生成小型补丁文件，可通过 U 盘/网盘/邮件分发，双击即可应用

**核心指标**：
- 常规代码更新补丁包体积控制在 10~50 MB（对比完整包 1.4 GB）
- 用户操作不超过两步（检查更新 → 重启）
- Win7 完全兼容，无需额外运行时

## 2. 体积分析与分层

### 当前安装包构成（~1.4 GB）

| 层级 | 组件 | 大小 | 变更频率 | 更新策略 |
|---|---|---|---|---|
| **L0 基础运行时** | linz.exe + DLL + locales | ~214 MB | 仅 Electron 大版本升级 | 随基础包安装，极少更新 |
| | Python 便携环境 | 406 MB | 几乎不变 | 同上 |
| | pandoc.exe | 223 MB | 几乎不变 | 同上 |
| | poppler | 22 MB | 很少变 | 同上 |
| | 原生模块（sqlite3/node-pty/sql.js） | 41 MB | 跟 Electron 版本走 | 同上 |
| | occt WASM | 7 MB | 很少变 | 同上 |
| **L1 应用层** | **app.asar（代码 + node_modules）** | **450 MB** | **每次发版** | **补丁主目标** |
| | resources/dsh-plugins | 1 MB | 偶尔 | 补丁覆盖 |
| | resources/skills | 20 MB | 偶尔 | 补丁覆盖 |

**关键洞察**：L0 基础运行时（~910 MB）几乎不变，可以"一次安装、长期使用"。真正需要补丁的是 L1 应用层，而 app.asar 虽然有 450 MB，但其中绝大部分是 node_modules，真正变化的代码可能只有几 MB——用二进制差分可以大幅压缩。

## 3. 总体架构

```
┌──────────────────────────────────────────────────────────┐
│                    构建时（CI / 开发机）                    │
│                                                          │
│  electron-builder 打包                                    │
│       │                                                  │
│       ▼                                                  │
│  gen-manifest.cjs ──→ manifest.json（全量文件清单+SHA256） │
│       │                                                  │
│       ▼                                                  │
│  gen-patch.cjs ──→ patch-{from}-to-{to}.zip（差分补丁包） │
│                   ├─ patch-manifest.json                 │
│                   └─ files/（变更文件或.bsdiff补丁）      │
│                                                          │
│  上传到更新服务器                                          │
└──────────────────────────┬───────────────────────────────┘
                           │
                    HTTPS 静态服务器
                           │
              ┌────────────┴───────────────┐
              ▼                            ▼
┌─────────────────────────┐  ┌──────────────────────────┐
│   在线自动更新（运行时）  │  │  离线补丁包（独立分发）    │
│                         │  │                          │
│  update-checker.ts      │  │  linz-patcher.exe        │
│  ├ 检查远程 manifest    │  │  ├ 读取 patch zip         │
│  ├ 对比本地版本         │  │  ├ 校验 from 版本匹配     │
│  ├ 下载变更文件→暂存    │  │  ├ 备份旧文件             │
│  ├ 校验 SHA256          │  │  ├ 应用补丁               │
│  └ 通知用户"重启生效"   │  │  └ 启动主应用             │
│                         │  │                          │
│  重启时 patch-applier    │  │  适用于：无网络环境、     │
│  应用暂存文件            │  │  内网分发、IT 统一部署     │
└─────────────────────────┘  └──────────────────────────┘
```

## 4. 核心数据结构

### 4.1 版本清单 manifest.json

构建后生成，作为"什么文件、什么版本"的事实来源。

```json
{
  "version": "0.2.0",
  "buildDate": "2026-09-02T10:00:00Z",
  "electronVersion": "22.3.27",
  "appPath": "resources/app.asar",
  "files": [
    {
      "path": "resources/app.asar",
      "sha256": "a1b2c3d4...",
      "size": 471859200,
      "category": "asar",
      "patchable": true
    },
    {
      "path": "resources/bin/win32/pandoc.exe",
      "sha256": "e5f6g7h8...",
      "size": 234881024,
      "category": "runtime",
      "patchable": false
    },
    {
      "path": "resources/dsh-plugins/dsh-synapse/index.js",
      "sha256": "i9j0k1l2...",
      "size": 39573,
      "category": "resources",
      "patchable": true
    }
  ]
}
```

字段说明：
- `category`：`asar`（应用代码）、`runtime`（基础运行时）、`resources`（插件/技能）
- `patchable`：是否参与差分补丁。L0 运行时通常 `false`（变更时走完整包）

### 4.2 补丁包 patch-manifest.json

```json
{
  "fromVersion": "0.1.0",
  "toVersion": "0.2.0",
  "createdAt": "2026-09-02T10:00:00Z",
  "totalSize": 35658824,
  "files": [
    {
      "path": "resources/app.asar",
      "type": "bsdiff",
      "patchFile": "files/resources/app.asar.bsdiff",
      "patchSize": 28512345,
      "targetSha256": "a1b2c3d4...",
      "targetSize": 471859200
    },
    {
      "path": "resources/dsh-plugins/dsh-synapse/index.js",
      "type": "full",
      "patchFile": "files/resources/dsh-plugins/dsh-synapse/index.js",
      "targetSha256": "i9j0k1l2...",
      "targetSize": 39573
    },
    {
      "path": "resources/dsh-plugins/dsh-synapse/package.json",
      "type": "full",
      "patchFile": "files/resources/dsh-plugins/dsh-synapse/package.json",
      "targetSha256": "m3n4o5p6...",
      "targetSize": 1029
    }
  ],
  "removed": [
    "resources/dsh-plugins/dsh-synapse/old-file.js"
  ]
}
```

文件类型：
- `full`：完整文件副本（用于小文件，< 5 MB 阈值）
- `bsdiff`：二进制差分补丁（用于大文件，≥ 5 MB 阈值）

## 5. 构建时工具

### 5.1 gen-manifest.cjs

**作用**：打包后扫描 `dist/win-unpacked/`，生成版本清单。

**流程**：
1. 读取 `package.json` 获取 `version`
2. 遍历 `dist/win-unpacked/` 下所有文件（排除临时文件）
3. 对每个文件计算 SHA256 + 大小
4. 根据路径模式分类 category（`resources/app.asar*` → asar，`resources/bin/**` → runtime，其他 resources → resources，根目录 exe/dll → electron）
5. 写出 `manifest.json`（用于上传服务器）和 `installed-manifest.json`（嵌入安装包，记录初始版本）

**嵌入方式**：将 `installed-manifest.json` 作为 extraResource 放入 `resources/installed-manifest.json`，应用启动时读取它来确定当前已安装版本。

### 5.2 gen-patch.cjs

**作用**：对比两个版本的 manifest，生成差分补丁包。

**流程**：
1. 读取 `manifest-old.json` 和 `manifest-new.json`
2. 对比文件列表：
   - 新增文件 → 完整包含
   - 删除文件 → 加入 `removed` 列表
   - SHA256 变化 → 需要更新
3. 对需要更新的文件：
   - 小文件（< 5 MB）：直接拷贝完整文件（`type: "full"`）
   - 大文件（≥ 5 MB）：生成 bsdiff 补丁（`type: "bsdiff"`）
4. 打包为 `patch-{from}-to-{to}.zip`

**bsdiff 依赖**：使用 `bsdiff` npm 包（纯 JS 实现，无原生依赖，Win7 兼容）或调用打包的 Python 的 `bsdiff` 模块。如果 bsdiff 不可用，回退到全量文件（仍比完整包小得多，因为只包含变化的文件）。

## 6. 运行时组件

### 6.1 在线更新检查器 update-checker.ts

**文件**：`src/main/updater/update-checker.ts`

```typescript
interface UpdateInfo {
  version: string
  currentVersion: string
  changelog?: string
  totalDownloadSize: number
  files: Array<{ path: string; url: string; sha256: string; size: number }>
}

class UpdateChecker {
  // 检查远程服务器是否有新版本
  async checkForUpdates(): Promise<UpdateInfo | null>

  // 下载变更文件到暂存目录
  async downloadUpdate(info: UpdateInfo, onProgress?: (p: number) => void): Promise<void>

  // 校验暂存目录中所有文件的 SHA256
  async verifyStagedFiles(): Promise<boolean>

  // 应用暂存文件并重启
  async applyAndRestart(): Promise<void>
}
```

**流程**：
1. 读取本地 `installed-manifest.json` 获取当前版本
2. GET `{UPDATE_URL}/manifest.json` 获取最新版本清单
3. 对比版本号；如果远程版本 > 本地版本：
   - GET `{UPDATE_URL}/versions/{remoteVersion}/manifest.json` 获取完整清单
   - 对比本地和远程文件列表，找出 SHA256 不一致的文件
   - 返回 `UpdateInfo`
4. 用户确认后，逐个下载变更文件到 `%APPDATA%/临智 LINZ/updates/staging/`
5. 下载完成后校验所有 SHA256
6. 通知渲染进程："更新已就绪，点击重启应用"

### 6.2 补丁应用器 patch-applier.ts

**文件**：`src/main/updater/patch-applier.ts`

**核心挑战**：Windows 文件锁定。

**文件锁定分析**：

| 文件类型 | 运行时锁定？ | 策略 |
|---|---|---|
| `app.asar` | 否（只读文件句柄，可替换） | 运行时替换，重启生效 |
| `resources/**`（插件/技能） | 否 | 运行时替换 |
| `linz.exe` | 是 | 需在应用退出后替换 |
| `*.dll` | 是 | 需在应用退出后替换 |
| `locales/**` | 可能 | 需在应用退出后替换 |

**两阶段策略**：

**阶段 A：运行时暂存（应用运行中）**
- 下载的文件存入 `%APPDATA%/临智 LINZ/updates/staging/`（保持目标目录结构）
- 校验完整性
- 写入 `updates/pending.json` 标记待应用

**阶段 B：应用补丁（重启时）**
- 应用启动早期（`app.whenReady()` 之后、窗口创建之前），检查 `updates/pending.json`
- 如果有待应用的更新：
  1. 备份当前文件到 `updates/backup/`
  2. 将暂存文件复制到目标位置
  3. 更新 `installed-manifest.json`
  4. 如果任何步骤失败，从 backup 回滚
  5. 清理 staging 和 backup 目录
- 继续正常启动流程

**关键设计决策**：不在应用运行中替换 `linz.exe` 和 DLL——这些文件极少变更（仅 Electron 大版本升级时）。当 L0 运行时需要更新时，生成完整基础包，提示用户下载安装。

### 6.3 离线补丁器

**两种实现方案**：

**方案 1：应用内置模式（推荐，零额外依赖）**

利用已有的 `linz.exe` 作为补丁器。通过命令行参数 `--apply-patch <path>` 触发补丁模式：

```
linz.exe --apply-patch "C:\Users\user\Downloads\linz-patch-0.1.0-to-0.2.0.zip"
```

- `src/main/index.ts` 在启动早期检查 `--apply-patch` 参数
- 如果存在，进入补丁模式：显示一个简单的进度窗口，应用补丁，完成后自动启动正常模式
- 离线补丁包的 `.zip` 文件可以注册文件关联，双击即用 `linz.exe --apply-patch` 打开
- 优点：零额外二进制，复用已有 Electron 运行时
- 缺点：依赖 linz.exe 本身能启动（如果 linz.exe 损坏则无法修补——但此时需要完整重装）

**方案 2：独立补丁 exe**

用 `pkg` 或 `nexe` 将一个小型 Node 脚本打包成独立 exe（~40MB）。独立于主应用运行。

- 优点：即使主应用损坏也能修补
- 缺点：额外 40MB 体积，维护成本高

**推荐方案 1**。L0 运行时损坏的概率极低，且用户可以随时重新安装基础包。

### 6.4 IPC 处理器 update.ipc.ts

**文件**：`src/main/ipc/update.ipc.ts`

| IPC 频道 | 作用 |
|---|---|
| `update:check` | 触发在线检查，返回 `UpdateInfo \| null` |
| `update:getStatus` | 获取当前状态（idle / downloading / ready / error） |
| `update:download` | 开始下载（带进度回调） |
| `update:applyAndRestart` | 应用暂存更新并重启 |
| `update:applyPatch(path)` | 应用指定路径的离线补丁包 |
| `update:onProgress` | 下载进度事件（渲染进程订阅） |

### 6.5 渲染进程 UI

在设置弹窗中新增"更新"页签：

```
┌─────────────────────────────────────────────┐
│  更新                                        │
│                                             │
│  当前版本：0.1.0                            │
│  最新版本：0.2.0  [有新版本可用]             │
│                                             │
│  更新内容：                                  │
│  • 修复会话地图打包后打不开的问题             │
│  • 新增 STEP 导入功能                       │
│  • 优化性能                                 │
│                                             │
│  下载大小：约 35 MB                          │
│                                             │
│  [检查更新]  [下载并安装]                    │
│                                             │
│  ─────────────────────────────────         │
│  离线补丁：点击此处选择补丁文件              │
│  [选择补丁包...]                            │
└─────────────────────────────────────────────┘
```

下载时显示进度条。下载完成后按钮变为"重启以完成更新"。

## 7. 更新服务器

最简方案：一个静态 HTTP 服务器（nginx / 对象存储 / GitHub Releases 均可）。

```
https://your-server.com/linz-updates/
├── manifest.json                          # 最新版本清单（精简版，含版本号+changelog+文件清单URL）
├── versions/
│   ├── 0.1.0/
│   │   └── manifest.json                  # 0.1.0 完整清单
│   ├── 0.2.0/
│   │   └── manifest.json                  # 0.2.0 完整清单
│   └── 0.3.0/
│       └── manifest.json
├── patches/
│   ├── 0.1.0-to-0.2.0.zip                # 差分补丁包
│   └── 0.2.0-to-0.3.0.zip
├── files/                                 # 在线更新的单文件下载目录
│   └── 0.2.0/
│       ├── resources/app.asar             # 完整 asar（在线更新时直接下载）
│       └── resources/dsh-plugins/...
└── full/                                  # 完整基础包（fallback）
    └── linz-0.2.0-base-setup.exe
```

**在线更新策略**：直接下载 `files/{version}/` 下变化的文件（全量文件，不做 bsdiff）。理由是在线更新场景下，网络下载的瓶颈是总字节量，bsdiff 需要在本地做 patch 运算（需要读取旧文件 + 生成 + 写入），对于 450MB 的 app.asar 来说，bsdiff 节省的下载量 vs 增加的本地计算开销需要权衡。

**离线补丁策略**：使用 bsdiff 差分包。理由是离线分发场景下，补丁包体积是唯一指标，用户不怕本地计算开销。

**简化方案**：如果 bsdiff 实现复杂，在线和离线都使用文件级差分（只下载变化的完整文件，不做二进制 diff）。对于代码更新，通常变化的文件只有 app.asar（450MB），如果 app.asar 每次都全量下载，补丁约 450MB——不够理想但比 1.4GB 好很多。后续可以引入 bsdiff 优化到 10~50MB。

## 8. 安全性

- **SHA256 校验**：所有下载文件校验 SHA256，防止传输损坏或篡改
- **HTTPS**：更新服务器必须使用 HTTPS
- **签名验证（可选）**：补丁包可以用应用的代码签名密钥签名，应用启动时验签
- **回滚机制**：每次应用补丁前备份旧文件，失败时自动回滚
- **原子性**：暂存 → 校验 → 备份 → 替换 → 验证，任何步骤失败都回滚

## 9. 兼容性考虑

### Win7 兼容性
- Electron 22 是最后一个支持 Win7 的 Electron 版本，更新系统不引入新的原生依赖
- `bsdiff`（如果使用）：选择纯 JS 实现（`bsdiff` npm 包），不依赖原生编译
- 文件操作使用 `fs.cpSync`、`fs.copyFileSync` 等 Node 16 API
- 不使用 Win10+ 专有 API（如 `MoveFileEx` 的 `MOVEFILE_REPLACE_EXISTING` 在 Win7 上行为不同）

### 跨版本更新
- 支持"跳版本"更新：0.1.0 → 0.3.0 不需要先装 0.2.0
- 在线更新：直接对比本地 manifest 和最新 manifest，下载所有不一致的文件
- 离线更新：生成"从任意旧版本到最新版本"的全量补丁，或提供版本链补丁

### 首次安装
- 新用户安装完整的 NSIS 安装包（包含 L0 + L1 + installed-manifest.json）
- 首次启动后，后续更新走补丁系统

## 10. 实施计划

### 阶段 1：核心框架（最小可用）
1. `scripts/gen-manifest.cjs` — 构建后生成版本清单
2. `src/main/updater/update-checker.ts` — 在线检查 + 下载 + 校验
3. `src/main/updater/patch-applier.ts` — 重启时应用暂存文件
4. `src/main/ipc/update.ipc.ts` — IPC 处理器
5. 渲染进程设置页"更新"标签
6. `electron-builder.yml` — 嵌入 `installed-manifest.json`

### 阶段 2：离线补丁
7. `--apply-patch` 命令行参数处理
8. 补丁包 zip 解析与应用
9. 离线补丁 UI（拖拽 / 文件选择）

### 阶段 3：优化
10. `scripts/gen-patch.cjs` — bsdiff 差分补丁生成
11. 下载断点续传
12. 增量更新（版本链）
13. 更新日志 changelog 展示

### 阶段 4：基础设施
14. 搭建静态更新服务器（或使用 GitHub Releases）
15. CI/CD 集成：自动生成 manifest + patch + 上传

## 11. 配置项

在 `app-config.ts` 中新增：

```typescript
// 更新配置
update: {
  // 更新服务器地址
  serverUrl: string  // 默认: ""（空则禁用在线更新）
  // 是否启动时自动检查
  autoCheckOnStartup: boolean  // 默认: true
  // 检查间隔（小时）
  checkIntervalHours: number  // 默认: 24
  // 代理设置（可选）
  proxy?: string
}
```

## 12. 风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|---|---|---|---|
| app.asar 被占用无法替换 | 低 | 更新失败 | asar 是只读文件，运行时不锁定，可安全替换 |
| 补丁应用中断（断电） | 低 | 文件损坏 | 备份-替换-验证三步法，失败自动回滚 |
| 版本清单不同步 | 中 | 重复下载 | 每次应用后更新 installed-manifest.json |
| Win7 文件系统行为差异 | 中 | 替换失败 | 使用 Node fs API，不依赖 Win API；充分测试 |
| bsdiff 在 Node 16 上不可用 | 中 | 补丁包变大 | 回退到文件级差分（全量文件，仍比完整包小） |
| 用户跳过多个版本 | 中 | 补丁链复杂 | 在线模式直接对比最新 manifest；离线模式生成全量补丁 |
