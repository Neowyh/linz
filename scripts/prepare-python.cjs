// 准备便携 Python 3.8.10 + 预装包（numpy/matplotlib/scipy/pandas）
//
// 用法（开发机，有网）：
//   node scripts/prepare-python.cjs
//
// 做的事：
//   1. 下载 python-3.8.10-embed-amd64.zip 到临时文件
//   2. 用 PowerShell Expand-Archive 解压到 resources/bin/win32/python/（fflate 对含数据描述符的 zip 解析有兼容问题）
//   3. 改 python38._pth 启用 import site + Lib/site-packages（让 pip 装的包可见）
//   4. 下载 get-pip.py 并用便携 python 装上 pip
//   5. pip install numpy matplotlib scipy pandas 到 site-packages
//
// 产物提交进 resources/bin/win32/python/，electron-builder 的 extraResources 会随包带走。
// 幂等：已存在且 import ok 时跳过下载/解压。

const https = require('https')
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync, spawnSync } = require('child_process')

const ROOT = path.resolve(__dirname, '..')
const PYTHON_DIR = path.join(ROOT, 'resources', 'bin', 'win32', 'python')

const PYTHON_VERSION = '3.8.10'
const EMBED_URL = `https://www.python.org/ftp/python/${PYTHON_VERSION}/python-${PYTHON_VERSION}-embed-amd64.zip`
const GET_PIP_URL = 'https://bootstrap.pypa.io/pip/3.8/get-pip.py'
const PACKAGES = ['numpy', 'matplotlib', 'scipy', 'pandas']

// 下载到文件（支持重定向 + 失败重试 + 校验最终大小）。
function downloadToFile(url, dest, retries = 3) {
  return new Promise((resolve, reject) => {
    const attempt = (remaining) => {
      const client = url.startsWith('https') ? https : http
      const req = client.get(url, { timeout: 300000 }, (res) => {
        // 处理重定向
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

// 便携 Python 的 _pth 默认禁用了 site（无 pip 无 site-packages）。
// 改为启用 import site 并加入 Lib/site-packages，让后续 pip 装的包可见。
function patchPthFile(pythonDir) {
  const pthFile = path.join(pythonDir, 'python38._pth')
  if (!fs.existsSync(pthFile)) {
    console.warn(`  ! 未找到 ${pthFile}，跳过 _pth 修补（pip 装的包可能不可见）`)
    return
  }
  let content = fs.readFileSync(pthFile, 'utf8')
  // 注释掉 # import site 行 → 启用 site
  content = content.replace(/^#\s*import\s+site/m, 'import site')
  // 追加 site-packages 路径（若未含）
  if (!/Lib\/site-packages/.test(content)) {
    content += '\nLib\nLib/site-packages\n'
  }
  fs.writeFileSync(pthFile, content, 'utf8')
  console.log(`  ✓ 已修补 python38._pth（启用 import site + site-packages）`)
}

// 探测便携 python.exe 是否就绪（能 import 全部预装包）
function pythonReady() {
  const exe = path.join(PYTHON_DIR, 'python.exe')
  if (!fs.existsSync(exe)) return false
  try {
    const result = execFileSync(exe, ['-c', `import ${PACKAGES.join(',')}; print('ok')`], {
      cwd: PYTHON_DIR,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30000,
      windowsHide: true
    }).toString().trim()
    return result === 'ok'
  } catch {
    return false
  }
}

async function main() {
  console.log('[prepare-python] 目标目录:', PYTHON_DIR)

  if (pythonReady()) {
    console.log('[prepare-python] 便携 Python 已就绪且预装包可 import，跳过。')
    return
  }

  ensureDir(PYTHON_DIR)

  // python.exe 已存在（用户手动解压）则跳过下载/解压，直接进入 _pth 修补 + 装包阶段
  const pyExe = path.join(PYTHON_DIR, 'python.exe')
  if (!fs.existsSync(pyExe)) {
    // 1. 下载 embeddable zip
    const tmpZip = path.join(os.tmpdir(), `python-${PYTHON_VERSION}-embed.zip`)
    if (!fs.existsSync(tmpZip)) {
      console.log(`[prepare-python] 下载 ${EMBED_URL}`)
      await downloadToFile(EMBED_URL, tmpZip)
    }
    console.log(`[prepare-python] 解压到 ${PYTHON_DIR}`)
    // 用 Windows 自带的 bsdtar (C:\Windows\System32\tar.exe) 解压
    // fflate 与 .NET ZipArchive 都对该 zip 的数据描述符解析失败，bsdtar (libarchive) 可正确处理
    const tarExe = process.env.SystemRoot ? path.join(process.env.SystemRoot, 'System32', 'tar.exe') : 'tar'
    const tarRes = spawnSync(tarExe, ['-xf', tmpZip, '-C', PYTHON_DIR], { stdio: 'inherit', windowsHide: true })
    if (tarRes.status !== 0) {
      throw new Error(`tar 解压失败（退出码 ${tarRes.status}）。bsdtar 仅 Windows 10+ 自带；Win7 需手动解压 zip。`)
    }
  } else {
    console.log('[prepare-python] python.exe 已存在，跳过下载/解压')
  }

  // 2. 修补 _pth
  patchPthFile(PYTHON_DIR)

  if (!fs.existsSync(pyExe)) {
    throw new Error(`解压后未找到 ${pyExe}`)
  }

  // 3. 装 pip（embeddable 不带 pip，用 get-pip.py）
  const getPipScript = path.join(PYTHON_DIR, 'get-pip.py')
  console.log(`[prepare-python] 下载 ${GET_PIP_URL}`)
  await downloadToFile(GET_PIP_URL, getPipScript)
  console.log('[prepare-python] 安装 pip ...')
  execFileSync(pyExe, [getPipScript, '--no-warn-script-location'], {
    cwd: PYTHON_DIR,
    stdio: 'inherit',
    windowsHide: true
  })

  // 4. 装预装包
  for (const pkg of PACKAGES) {
    console.log(`[prepare-python] pip install ${pkg} ...`)
    execFileSync(pyExe, ['-m', 'pip', 'install', pkg, '--no-warn-script-location'], {
      cwd: PYTHON_DIR,
      stdio: 'inherit',
      windowsHide: true
    })
  }

  // 5. 验证
  if (!pythonReady()) {
    throw new Error('预装包验证失败：python.exe 无法 import 全部预装包')
  }
  console.log('[prepare-python] ✓ 完成，所有预装包可正常 import。')
}

main().catch((err) => {
  console.error('[prepare-python] ✗ 失败:', err.message || err)
  process.exit(1)
})
