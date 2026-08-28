// 确定性沙箱测试：不依赖 Electron / LLM，直接调用真实沙箱模块验证防护是否生效。
//
// 运行方式（已安装 esbuild，electron-vite 自带）：
//   node_modules/.bin/esbuild scripts/sandbox-test.ts --bundle --platform=node \
//     --format=esm --outfile=scripts/.sandbox-test.mjs
//   node scripts/.sandbox-test.mjs
//
// 覆盖层：
//   1. 路径围栏 resolveWithinRoot —— 越界访问必须被拒绝
//   2. 文件工具黑名单 —— .bat/.exe/.dll 等写入必须被拒
//   3. 环境清洗 buildSafeEnv —— 敏感变量不得泄露给脚本进程
//   4. 安全计算器 —— 拒绝任意代码执行（require/process 等）

import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { resolveWithinRoot } from '../src/main/fs/path-guard'
import { createFilesystemTools } from '../src/main/agents/tools/filesystem.tool'
import { buildSafeEnv, ENV_ALLOWLIST } from '../src/main/security/env-sandbox'
import { calculatorTool } from '../src/main/agents/tools/calculator.tool'

let pass = 0
let fail = 0
const failures: string[] = []

function check(name: string, cond: boolean, detail?: string): void {
  if (cond) {
    pass++
    console.log(`  ✔ ${name}`)
  } else {
    fail++
    failures.push(name)
    console.log(`  ✘ ${name}${detail ? `  —— ${detail}` : ''}`)
  }
}

async function invokeTool(tool: any, input: any): Promise<string> {
  try {
    const r = await tool.invoke(input)
    return String(r)
  } catch (err: any) {
    return `TOOL_ERROR: ${err?.message || err}`
  }
}

async function main(): Promise<void> {
  // ---------- 1. 路径围栏 ----------
  console.log('\n[1] 路径围栏 resolveWithinRoot')
  {
    const root = path.join(os.tmpdir(), 'sandbox-root-a')
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true })
    const ok = resolveWithinRoot('sub/note.txt', root)
    check('根内相对路径放行', ok.ok === true, `resolved=${ok.resolved}`)

    const up = resolveWithinRoot('../escape.txt', root)
    check('相对越界 ../ 被拒', up.ok === false, up.error)

    const abs = resolveWithinRoot(path.join(path.parse(root).root, 'Windows', 'System32', 'hosts'), root)
    check('绝对路径越界被拒', abs.ok === false, abs.error)

    const encoded = resolveWithinRoot('..%2Fescape.txt', root)
    check('编码遍历原样当文件名(不解析为越界)', encoded.ok === true, `resolved=${encoded.resolved}`)

    const exact = resolveWithinRoot('sub', root)
    check('根目录本身(无尾斜杠)视为合法', exact.ok === true)
  }

  // ---------- 2. 文件工具黑名单 + 围栏 ----------
  console.log('\n[2] 文件工具（写黑名单 + 围栏）')
  {
    const root = path.join(os.tmpdir(), 'sandbox-root-b')
    fs.mkdirSync(root, { recursive: true })
    const [fileRead, fileWrite, fileList] = createFilesystemTools({ context: { fileWorkspacePath: root } } as any)

    let r = await invokeTool(fileWrite, { path: 'demo.txt', content: 'hello' })
    check('根内正常写入成功', r.includes('已写入'), r)

    r = await invokeTool(fileRead, { path: 'demo.txt' })
    check('根内读取返回内容', r.includes('hello'), r)

    for (const ext of ['bat', 'exe', 'dll', 'ps1', 'reg']) {
      r = await invokeTool(fileWrite, { path: `evil.${ext}`, content: 'x' })
      check(`写入 .${ext} 被黑名单拦截`, r.includes('禁止写入'), r)
    }

    r = await invokeTool(fileWrite, { path: '../outside.txt', content: 'x' })
    check('写入越界 ../ 被拒', r.includes('越界') || r.includes('路径越界'), r)

    r = await invokeTool(fileRead, { path: '../../outside.txt' })
    check('读取越界被拒', r.includes('越界') || r.includes('路径越界'), r)

    r = await invokeTool(fileList, { path: '..' })
    check('列目录越界被拒', r.includes('越界') || r.includes('路径越界'), r)
  }

  // ---------- 3. 环境清洗 ----------
  console.log('\n[3] 环境清洗 buildSafeEnv')
  {
    // 注入敏感变量，模拟用户环境中存在的凭据
    const sensitive = ['SECRET_TOKEN', 'API_KEY', 'DEEPSEEK_API_KEY', 'MCP_TOKEN', 'AUTH_PASSWORD']
    for (const k of sensitive) {
      process.env[k] = 'leaked-value-' + k
    }
    process.env.PATH = process.env.PATH || '/usr/bin'

    const env = buildSafeEnv({ EXTRA: '1' })
    for (const k of sensitive) {
      check(`敏感变量 ${k} 不泄露`, env[k] === undefined)
    }
    check('白名单 PATH 保留', env.PATH === process.env.PATH)
    check('extra 追加生效', env.EXTRA === '1')
    const allowMiss = ENV_ALLOWLIST.filter((k) => env[k] === undefined && process.env[k] !== undefined)
    check('白名单变量全部保留', allowMiss.length === 0, allowMiss.join(','))
    check('无 extra 时不含白名单外变量', Object.keys(buildSafeEnv()).every((k) => ENV_ALLOWLIST.includes(k)))
  }

  // ---------- 4. 安全计算器拒绝代码注入 ----------
  console.log('\n[4] 安全计算器')
  {
    const calc = async (expr: string): Promise<string> => {
      try {
        const r = await calculatorTool.invoke(expr)
        return String(r)
      } catch (err: any) {
        return `TOOL_ERROR: ${err?.message || err}`
      }
    }

    const r1 = await calc('2 + 3 * 4')
    check('正常算式求值', r1.includes('14'), r1)

    const r2 = await calc('process.exit(1)')
    check('拒绝 process 调用', r2.includes('不支持') || r2.includes('无效') || r2.includes('错误') || r2.includes('未识别'), r2)

    const r3 = await calc("require('fs')")
    check('拒绝 require 调用', r3.includes('不支持') || r3.includes('无效') || r3.includes('错误') || r3.includes('未识别'), r3)

    const r4 = await calc('globalThis')
    check('拒绝 globalThis', r4.includes('不支持') || r4.includes('无效') || r4.includes('错误') || r4.includes('未识别'), r4)
  }

  // ---------- 汇总 ----------
  console.log(`\n结果: ${pass} 通过, ${fail} 失败`)
  if (fail > 0) {
    console.log('失败项:\n  - ' + failures.join('\n  - '))
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('测试执行出错:', err)
  process.exit(2)
})
