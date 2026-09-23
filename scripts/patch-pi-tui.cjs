#!/usr/bin/env node
// 修复 @earendil-works/pi-tui 的 v-flag 正则在 Electron 22 (V8 10.8) 下无法加载的问题。
//
// 根因：pi-tui@0.80.x 的 dist/utils.js:34-36 用了 ES2024 正则 v flag（Unicode Sets），
// 其中 \p{RGI_Emoji} 是字符串值属性、必须 v flag。本项目 Electron 22.3.27 内置
// V8 10.8 不支持 v flag（需 V8 12.0+/Electron 31+），ESM parse 阶段抛
// "Invalid regular expression flags"，导致 import('@earendil-works/pi-coding-agent') 中止。
//
// 修复：把 3 行 v-flag 正则改为 u-flag 等价写法（行 34/35 二值属性 u 下合法；
// 行 36 RGI_Emoji 是字符串属性，u 下不合法，改用显式 emoji 码点范围近似）。
// 仅影响 pi-tui 显示宽度判定，降级最多让个别 emoji 宽度算错，不影响 Pi 核心功能。
//
// 幂等：已 patch（含 PATCH_TAG）则跳过；精确匹配失败则跳过该行（pi-tui 升级改了内容不会 patch 错）。
// 挂在 package.json postinstall，npm install 后自动应用。

const fs = require('fs')
const path = require('path')

const candidates = [
  // 嵌套位置（pi-tui 作为 pi-coding-agent 的依赖）
  path.join(__dirname, '..', 'node_modules', '@earendil-works', 'pi-coding-agent', 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'utils.js'),
  // hoisted 顶层位置
  path.join(__dirname, '..', 'node_modules', '@earendil-works', 'pi-tui', 'dist', 'utils.js')
]

const PATCH_TAG = '/* linz-patch-pi-tui-vflag */'

const replacements = [
  {
    from: String.raw`const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/v;`,
    to: String.raw`const zeroWidthRegex = /^(?:\p{Default_Ignorable_Code_Point}|\p{Control}|\p{Mark}|\p{Surrogate})+$/u;`
  },
  {
    from: String.raw`const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/v;`,
    to: String.raw`const leadingNonPrintingRegex = /^[\p{Default_Ignorable_Code_Point}\p{Control}\p{Format}\p{Mark}\p{Surrogate}]+/u;`
  },
  {
    // \p{RGI_Emoji} 是字符串值属性，u flag 下不合法，改用显式 emoji 码点范围（近似 RGI）。
    from: String.raw`const rgiEmojiRegex = /^\p{RGI_Emoji}$/v;`,
    to: String.raw`const rgiEmojiRegex = /^[\u{1F000}-\u{1F0FF}\u{1F100}-\u{1F1FF}\u{1F200}-\u{1F2FF}\u{1F300}-\u{1F4FF}\u{1F500}-\u{1F5FF}\u{1F600}-\u{1F64F}\u{1F680}-\u{1F6FF}\u{1F700}-\u{1F77F}\u{1F780}-\u{1F7FF}\u{1F800}-\u{1F8FF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA6F}\u{1FA70}-\u{1FAFF}\u{2600}-\u{26FF}\u{2700}-\u{27BF}\u{2B50}-\u{2B55}\u{1F1E6}-\u{1F1FF}\uFE0F\u200D]+$/u;`
  }
]

let patchedCount = 0
for (const target of candidates) {
  if (!fs.existsSync(target)) continue
  let src = fs.readFileSync(target, 'utf8')
  if (src.includes(PATCH_TAG)) {
    console.log('[patch-pi-tui] already patched, skip:', target)
    continue
  }
  let changed = false
  for (const { from, to } of replacements) {
    if (src.includes(from)) {
      src = src.replace(from, to)
      changed = true
    }
  }
  if (!changed) {
    console.warn('[patch-pi-tui] no patterns matched (pi-tui may have upgraded, please update this script):', target)
    continue
  }
  src = PATCH_TAG + '\n' + src
  fs.writeFileSync(target, src, 'utf8')
  patchedCount++
  console.log('[patch-pi-tui] patched:', target)
  // patch 后仍含 /v; 说明有未覆盖的 v-flag 用法
  if (/\/v;/.test(src)) {
    console.warn('[patch-pi-tui] WARNING: file still contains /v; — pi-tui may have new v-flag usages, update patch script')
  }
}
if (patchedCount === 0) {
  console.log('[patch-pi-tui] no files patched (pi-tui not installed or already patched)')
}
