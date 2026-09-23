// 准备 Office/PDF 技能依赖：Python pip 包 + Poppler 二进制 + npm 库（docx/pptxgenjs）
//
// 用法（开发机，有网）：
//   node scripts/prepare-skill-deps.cjs
//
// 做的事（幂等，可重复运行）：
//   1. pip install 四个 skill（docx/pdf/pptx/xlsx）所需的 Python 包到内置便携 Python
//      （lxml / defusedxml / openpyxl / python-docx / python-pptx / pypdf / pdfplumber /
//       reportlab / pdf2image 等，全部取 py3.8 兼容版本，运行时完全离线）
//   2. 下载 poppler-windows 发布包，提取 pdftoppm/pdftotext/pdfinfo/pdfimages 及依赖 DLL
//      到 resources/bin/win32/poppler/（pdf 转图 / 文本提取用）
//   3. npm install docx pptxgenjs 到 resources/skills/node_modules/
//      （供内置 node 工具 require，docx-js / pptxgenjs 创建流程）
//   4. 从 skills-main 源目录同步四个技能的 scripts/ 与 LICENSE.txt 到 resources/skills/<id>/
//      （SKILL.md 为仓库内手写改写的内置版，不在同步范围）
//
// 产物提交进仓库，electron-builder 的 extraResources 会随包带走。
// 先运行 scripts/prepare-python.cjs 准备便携 Python。

const https = require('https')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PYTHON_DIR = path.join(ROOT, 'resources', 'bin', 'win32', 'python')
const PYTHON_EXE = path.join(PYTHON_DIR, 'python.exe')
const POPPLER_DIR = path.join(ROOT, 'resources', 'bin', 'win32', 'poppler')
const SKILLS_DIR = path.join(ROOT, 'resources', 'skills')
// 上游技能源目录（win7-verify 仓库之外的技能仓库）
const SKILLS_SOURCE = 'E:\\lijx\\plane3d\\Design_Multi-Agent\\skills\\skills-main\\skills'

// 内置技能 id → 上游目录名
const SKILL_IDS = [
  { id: 'agent-skill-docx', dir: 'docx' },
  { id: 'agent-skill-pdf', dir: 'pdf' },
  { id: 'agent-skill-pptx', dir: 'pptx' },
  { id: 'agent-skill-xlsx', dir: 'xlsx' }
]

// pip 安装的包（pip 会自动挑选 py3.8 兼容的最后一个版本）
// reportlab 固定 4.2.2：4.3+ 使用 hashlib.md5(usedforsecurity=False)，该参数 Python 3.8 不支持，运行时必崩
const PIP_PACKAGES = [
  'lxml',
  'defusedxml',
  'openpyxl',
  'et_xmlfile',
  'python-docx',
  'python-pptx',
  'XlsxWriter',
  'pypdf',
  'pdfplumber',
  'pdfminer.six',
  'reportlab==4.2.2',
  'pdf2image',
  'charset-normalizer',
  'cryptography'
]

// 验证脚本（import 全部依赖，任一失败即视为未就绪）
const IMPORT_CHECK = 'import lxml, defusedxml, openpyxl, docx, pptx, pypdf, pdfplumber, pdfminer, reportlab, pdf2image; print("ok")'

// Poppler 发布包（oschwartz10612/poppler-windows）。若 Win7 上运行异常，退回更早版本
// （如 v23.11.0-0 / Release-23.11.0-0.zip）。
const POPPLER_VERSION = 'v24.02.0-0'
const POPPLER_ASSET = 'Release-24.02.0-0.zip'
const POPPLER_URL = `https://github.com/oschwartz10612/poppler-windows/releases/download/${POPPLER_VERSION}/${POPPLER_ASSET}`

// 需要的 poppler 可执行文件（其余 exe 丢弃；DLL 全部保留，避免漏依赖）
const POPPLER_EXES = ['pdftoppm.exe', 'pdftotext.exe', 'pdfinfo.exe', 'pdfimages.exe']

// 本机 Windows 系统代理可能配置了不可用的代理服务器（代理软件未运行时 pip 会 ProxyError）。
// pip/npm 调用统一注入 no_proxy=* 绕过系统代理，直接访问镜像/源站。
function noProxyEnv() {
  return { ...process.env, no_proxy: '*', NO_PROXY: '*' }
}

// 优先用系统 curl 下载（Windows 10+ 自带；对 GitHub 直连/重定向更稳）。
// 返回 true 表示下载成功且文件非空；curl 不可用或失败返回 false。
function downloadWithCurl(url, dest) {
  const curl = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'curl.exe') : 'curl'
  if (!fs.existsSync(curl)) return false
  const res = spawnSync(curl, ['-sL', '--connect-timeout', '30', '--retry', '2', '-o', dest, url], {
    stdio: 'inherit',
    windowsHide: true,
    timeout: 600000
  })
  return res.status === 0 && fs.existsSync(dest) && fs.statSync(dest).size > 0
}

// 下载到文件（支持重定向 + 失败重试 + 校验最终大小）
function downloadToFile(url, dest, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      const req = https.get(url, { timeout: 600000 }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return downloadToFile(res.headers.location, dest, remaining).then(resolve, reject)
        }
        if (res.statusCode !== 200) {
          res.resume()
          if (remaining > 0) {
            console.log(`  HTTP ${res.statusCode}，重试（剩余 ${remaining}）...`)
            return setTimeout(() => attempt(remaining - 1), 2000)
          }
          return reject(new Error(`下载失败 ${url}: HTTP ${res.statusCode}`))
        }
        const expected = res.headers['content-length'] ? parseInt(res.headers['content-length'], 10) : 0
        const stream = fs.createWriteStream(dest)
        let received = 0
        res.on('data', (c) => { received += c.length })
        res.pipe(stream)
        stream.on('finish', () => stream.close(() => {
          if (expected > 0 && received !== expected) {
            console.warn(`  ⚠ 下载不完整：收到 ${received} / 预期 ${expected} 字节`)
            if (remaining > 0) {
              return setTimeout(() => attempt(remaining - 1), 2000)
            }
            return reject(new Error(`下载不完整：${received}/${expected}`))
          }
          resolve(dest)
        }))
        stream.on('error', reject)
      })
      req.on('error', (err) => {
        if (remaining > 0) {
          console.log(`  网络错误 ${err.message}，重试（剩余 ${remaining}）...`)
          return setTimeout(() => attempt(remaining - 1), 2000)
        }
        reject(err)
      })
      req.on('timeout', () => req.destroy(new Error('下载超时')))
    }
    attempt(retries)
  })
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

// Windows 上删除大目录偶发 EPERM（文件句柄未释放/杀软扫描），重试几次；
// Node 删不掉时退回 cmd rmdir（Windows 原生删除，对目录树更稳）
function rmSyncRetry(target) {
  for (let i = 0; i < 5; i++) {
    try {
      fs.rmSync(target, { recursive: true, force: true })
      return
    } catch (err) {
      if (i === 4) break
      const delay = 300 * (i + 1)
      console.log(`  ! 删除 ${target} 失败（${err.code}），${delay}ms 后重试 ...`)
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delay)
    }
  }
  if (process.platform === 'win32') {
    const r = spawnSync(process.env.ComSpec || 'cmd.exe', ['/c', 'rmdir', '/s', '/q', target], {
      stdio: 'ignore',
      windowsHide: true
    })
    if (r.status === 0) return
  }
  throw new Error(`无法删除目录: ${target}`)
}

function skillDepsReady() {
  if (!fs.existsSync(PYTHON_EXE)) return false
  try {
    const result = execFileSync(PYTHON_EXE, ['-c', IMPORT_CHECK], {
      cwd: PYTHON_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60000,
      windowsHide: true
    }).toString().trim()
    return result === 'ok'
  } catch {
    return false
  }
}

// 步骤 1：pip 安装技能依赖
function installPipDeps() {
  if (skillDepsReady()) {
    console.log('[prepare-skill-deps] 技能 Python 依赖已就绪（全部可 import），跳过 pip 安装。')
    return
  }
  if (!fs.existsSync(PYTHON_EXE)) {
    throw new Error(`未找到内置便携 Python（${PYTHON_EXE}）。请先运行 node scripts/prepare-python.cjs`)
  }
  console.log('[prepare-skill-deps] pip install 技能依赖包 ...')
  execFileSync(PYTHON_EXE, ['-m', 'pip', 'install', ...PIP_PACKAGES, '--no-warn-script-location'], {
    cwd: PYTHON_DIR,
    stdio: 'inherit',
    windowsHide: true,
    env: noProxyEnv()
  })
  if (!skillDepsReady()) {
    throw new Error('技能 Python 依赖验证失败：python.exe 无法 import 全部依赖包')
  }
  console.log('[prepare-skill-deps] ✓ 技能 Python 依赖安装完成并可正常 import。')
}

// 步骤 2：Poppler 二进制
async function installPoppler() {
  // 已就绪判定：四个 exe 都存在
  const ready = POPPLER_EXES.every((name) => fs.existsSync(path.join(POPPLER_DIR, name)))
  if (ready) {
    console.log('[prepare-skill-deps] Poppler 已就绪，跳过。')
    return
  }
  const tmpZip = path.join(os.tmpdir(), POPPLER_ASSET)
  if (!fs.existsSync(tmpZip) || fs.statSync(tmpZip).size === 0) {
    console.log(`[prepare-skill-deps] 下载 ${POPPLER_URL}`)
    if (!downloadWithCurl(POPPLER_URL, tmpZip)) {
      console.log('[prepare-skill-deps] curl 下载失败或不可用，改用 Node 下载 ...')
      await downloadToFile(POPPLER_URL, tmpZip)
    }
    if (!fs.existsSync(tmpZip) || fs.statSync(tmpZip).size === 0) {
      throw new Error('Poppler 下载结果为空或文件不存在')
    }
  }
  // 用 Windows 自带 bsdtar 解压（与 prepare-python.cjs 一致）
  const tarExe = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'
  const extractDir = path.join(os.tmpdir(), 'poppler-windows-extract')
  fs.rmSync(extractDir, { recursive: true, force: true })
  ensureDir(extractDir)
  console.log('[prepare-skill-deps] 解压 poppler 到临时目录 ...')
  const tarRes = spawnSync(tarExe, ['-xf', tmpZip, '-C', extractDir], { stdio: 'inherit', windowsHide: true })
  if (tarRes.status !== 0) {
    throw new Error(`poppler 解压失败（退出码 ${tarRes.status}）`)
  }
  // 定位 bin 目录（Release-*/bin）
  const bins = []
  const walk = (dir) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, f.name)
      if (f.isDirectory()) {
        if (f.name === 'bin') bins.push(full)
        else walk(full)
      }
    }
  }
  walk(extractDir)
  if (bins.length === 0) throw new Error('poppler 发布包中未找到 bin 目录')
  const srcBin = bins[0]
  ensureDir(POPPLER_DIR)
  const copied = []
  for (const name of POPPLER_EXES) {
    const src = path.join(srcBin, name)
    if (!fs.existsSync(src)) throw new Error(`poppler 发布包缺少 ${name}`)
    fs.copyFileSync(src, path.join(POPPLER_DIR, name))
    copied.push(name)
  }
  // 依赖 DLL 全部保留（运行时按需加载，缺失会直接启动失败）
  for (const f of fs.readdirSync(srcBin)) {
    if (f.toLowerCase().endsWith('.dll')) {
      fs.copyFileSync(path.join(srcBin, f), path.join(POPPLER_DIR, f))
      copied.push(f)
    }
  }
  // 便携 Python 目录里已有 vcruntime140.dll，复制一份到 poppler 目录保证独立可用
  const vcruntime = path.join(PYTHON_DIR, 'vcruntime140.dll')
  if (fs.existsSync(vcruntime)) {
    fs.copyFileSync(vcruntime, path.join(POPPLER_DIR, 'vcruntime140.dll'))
  }
  fs.rmSync(extractDir, { recursive: true, force: true })
  const total = copied.reduce((sum, n) => sum + fs.statSync(path.join(POPPLER_DIR, n)).size, 0)
  console.log(`[prepare-skill-deps] ✓ Poppler 就绪（${copied.length} 个文件，约 ${(total / 1024 / 1024).toFixed(1)} MB）`)
}

// 步骤 3：npm 库（docx / pptxgenjs）
function installNpmLibs() {
  const nodeModules = path.join(SKILLS_DIR, 'node_modules')
  const ok = ['docx', 'pptxgenjs'].every((p) => fs.existsSync(path.join(nodeModules, p)))
  if (ok) {
    console.log('[prepare-skill-deps] npm 库（docx/pptxgenjs）已就绪，跳过。')
    return
  }
  ensureDir(SKILLS_DIR)
  console.log('[prepare-skill-deps] npm install docx pptxgenjs ...')
  // 直接经 Node 调用 npm-cli.js：避免 Windows 上 npm.cmd / shell 脚本 spawn 的兼容问题
  // 优先探测 node 安装目录下捆绑的 npm（如 D:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js）
  let npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
  if (!fs.existsSync(npmCli)) {
    try {
      npmCli = execFileSync(process.execPath, ['-p', "require.resolve('npm/bin/npm-cli.js')"], {
        stdio: ['ignore', 'pipe', 'ignore'],
        windowsHide: true
      }).toString().trim()
    } catch {
      npmCli = ''
    }
  }
  if (!npmCli || !fs.existsSync(npmCli)) {
    throw new Error('无法定位 npm-cli.js（当前 Node 未捆绑 npm？）')
  }
  const res = spawnSync(
    process.execPath,
    [npmCli, 'install', '--prefix', SKILLS_DIR, '--no-save', '--omit=dev', 'docx', 'pptxgenjs'],
    {
      cwd: ROOT,
      stdio: 'inherit',
      windowsHide: true,
      env: noProxyEnv()
    }
  )
  if (res.status !== 0) {
    throw new Error(`npm install 失败（退出码 ${res.status}）`)
  }
  console.log('[prepare-skill-deps] ✓ npm 库安装完成。')
}

// 步骤 4：从上游同步四个技能的 scripts/ 与 LICENSE.txt
function syncSkillScripts() {
  for (const { id, dir } of SKILL_IDS) {
    const srcSkill = path.join(SKILLS_SOURCE, dir)
    const dstSkill = path.join(SKILLS_DIR, id)
    if (!fs.existsSync(srcSkill)) {
      console.warn(`  ! 上游技能目录不存在，跳过：${srcSkill}`)
      continue
    }
    ensureDir(dstSkill)
    for (const part of ['scripts', 'LICENSE.txt']) {
      const src = path.join(srcSkill, part)
      if (!fs.existsSync(src)) continue
      rmSyncRetry(path.join(dstSkill, part))
      fs.cpSync(src, path.join(dstSkill, part), { recursive: true })
    }
    console.log(`  ✓ 已同步 ${id}（${dir}）的 scripts/ 与 LICENSE.txt`)
  }
}

// 上游 office 脚本使用 Python 3.10+ 的类型注解语法（str | None、dict[str, ...] 等），
// 而内置便携 Python 是 3.8（Win7 最高支持版本）。给缺失的文件注入
// `from __future__ import annotations`（PEP 563：注解延迟求值，Python 3.7+ 支持），
// 使注解在 3.8 下只是字符串、运行时不再解析。
// 必须在 syncSkillScripts 之后调用（同步会覆盖补丁，补丁需重新应用）。
function patchPy38Compatibility() {
  const FUTURE = 'from __future__ import annotations'
  // 泛型下标注解（dict[str,...]、Iterable[str] 等）或 | 联合注解（str | None）。
  // 匹配偏宽没关系：该补丁只是让注解延迟求值，对任何 Python 3.8 文件均无害。
  const NEEDS_RE = /\b[A-Za-z_][A-Za-z0-9_.]*\[[A-Za-z_][A-Za-z0-9_.]*\]| \| /
  // soffice.py：Windows 无 socket.AF_UNIX（shim 是 Linux LD_PRELOAD 机制，Windows 不需要）
  const AF_UNIX_OLD =
    'def _needs_shim() -> bool:\n    try:\n        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)'
  const AF_UNIX_NEW =
    'def _needs_shim() -> bool:\n    # Windows 无 AF_UNIX（shim 是 Linux LD_PRELOAD 机制，Windows 不需要）\n    if not hasattr(socket, "AF_UNIX"):\n        return False\n    try:\n        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)'
  let patched = 0
  for (const { id } of SKILL_IDS) {
    const scriptsDir = path.join(SKILLS_DIR, id, 'scripts')
    if (!fs.existsSync(scriptsDir)) continue
    const walk = (dir) => {
      for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, f.name)
        if (f.isDirectory()) {
          if (f.name !== '__pycache__') walk(full)
          continue
        }
        if (!f.name.endsWith('.py')) continue
        let text = fs.readFileSync(full, 'utf8')
        const original = text
        // 运行时 API 兼容：TemporaryDirectory(ignore_cleanup_errors=...) 是 Python 3.10+ 参数，
        // 3.8 不支持；该参数只是放宽清理异常处理，去掉不影响功能
        text = text.replace(/,\s*\n?\s*ignore_cleanup_errors=(?:True|False)/g, '')
        // soffice.py 的 AF_UNIX 探测兼容 Windows
        text = text.replace(AF_UNIX_OLD, AF_UNIX_NEW)
        // validate.py 的 match 语句是 Python 3.10+ 语法，改为 if/elif/else
        // （elif/else 与 if 同级缩进；分支主体缩进保持原样，Python 允许块内一致的非标准缩进量）
        text = text
          .replace('    match family:\n        case "docx":', '    if family == "docx":')
          .replace('        case "pptx":', '    elif family == "pptx":')
          .replace('        case "xlsx":', '    elif family == "xlsx":')
          .replace('        case _:', '    else:')
        // helpers/safe_extract：Path.is_relative_to 是 Python 3.9+ API，3.8 用 relative_to 抛异常判定
        text = text
          .replace(
            '        if not target.is_relative_to(dest):\n            raise ValueError(f"unsafe archive entry: {m.filename!r}")',
            '        # is_relative_to 是 Python 3.9+ API，3.8 用 relative_to 抛异常判定\n' +
            '        try:\n' +
            '            target.relative_to(dest)\n' +
            '        except ValueError:\n' +
            '            raise ValueError(f"unsafe archive entry: {m.filename!r}")'
          )
        // 类型注解语法兼容：缺失时注入 from __future__ import annotations（PEP 563，3.7+ 支持）
        if (!text.includes(FUTURE) && NEEDS_RE.test(text)) {
          // 文件开头 docstring 之后插入（__future__ import 必须位于模块 docstring 之后、其他 import 之前）
          const dm = text.match(/^(?:"""[\s\S]*?"""|\'\'\'[\s\S]*?\'\'\')/)
          const insertAt = dm ? dm[0].length : 0
          const leadMatch = text.slice(insertAt).match(/^\n*/)
          const lead = leadMatch ? leadMatch[0] : ''
          const rest = text.slice(insertAt + lead.length)
          text = text.slice(0, insertAt) + lead + FUTURE + '\n' + rest
        }
        if (text === original) continue
        fs.writeFileSync(full, text, 'utf8')
        patched++
      }
    }
    walk(scriptsDir)
  }
  console.log(`[prepare-skill-deps] Python 3.8 兼容补丁（注解语法 + TemporaryDirectory/AF_UNIX API）: 处理 ${patched} 个文件`)
}

async function main() {
  console.log('[prepare-skill-deps] 目标:', { python: PYTHON_DIR, poppler: POPPLER_DIR, skills: SKILLS_DIR })
  installPipDeps()
  await installPoppler()
  installNpmLibs()
  syncSkillScripts()
  patchPy38Compatibility()
  console.log('[prepare-skill-deps] ✓ 全部完成。')
}

main().catch((err) => {
  console.error('[prepare-skill-deps] ✗ 失败:', err.message || err)
  process.exit(1)
})
