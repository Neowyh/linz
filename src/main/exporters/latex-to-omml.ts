import {
  Math as DocxMath,
  MathRun,
  MathFraction,
  MathSuperScript,
  MathSubScript,
  MathSubSuperScript,
  MathRadical,
  MathSum,
  MathIntegral,
  type MathComponent
} from 'docx'

// LaTeX 命令 → Unicode 字符映射（常用希腊字母 + 符号）
const SYMBOL_MAP: Record<string, string> = {
  // Greek lowercase
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
  zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'θ', iota: 'ι', kappa: 'κ',
  lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'φ',
  varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  // Greek uppercase
  Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ', Epsilon: 'Ε', Zeta: 'Ζ',
  Eta: 'Η', Theta: 'Θ', Iota: 'Ι', Kappa: 'Κ', Lambda: 'Λ', Mu: 'Μ', Nu: 'Ν',
  Xi: 'Ξ', Pi: 'Π', Rho: 'Ρ', Sigma: 'Σ', Tau: 'Τ', Upsilon: 'Υ', Phi: 'Φ',
  Chi: 'Χ', Psi: 'Ψ', Omega: 'Ω',
  // Operators / relations
  times: '×', div: '÷', cdot: '·', pm: '±', mp: '∓', ast: '∗', star: '⋆',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', neq: '≠', ne: '≠', approx: '≈',
  equiv: '≡', sim: '∼', propto: '∝', perp: '⊥', parallel: '∥', angle: '∠',
  in: '∈', notin: '∉', subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', forall: '∀', exists: '∃', neg: '¬',
  // Arrows
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', mapsto: '↦',
  uparrow: '↑', downarrow: '↓',
  // Calculus
  infty: '∞', partial: '∂', nabla: '∇', sum: '∑', int: '∫', prod: '∏',
  oint: '∮', bigcup: '⋃', bigcap: '⋂',
  // Misc
  cdots: '⋯', ldots: '…', vdots: '⋮', ddots: '⋱',
  prime: '′', backslash: '\\', '%': '%', '#': '#', '&': '&',
  sqrt: '√', frac: 'frac', left: '(', right: ')',
  // Spaces
  ',': ' ', ':': ' ', ';': ' ', '!': '', quad: '  ', qquad: '    ',
  // Fonts (render as plain text)
  textbf: '', textit: '', mathrm: '', mathbf: '', mathit: '',
  // Sizing / styling we don't translate
  displaystyle: '', scriptstyle: '', limits: '', nolimits: ''
}

interface ParseState {
  src: string
  pos: number
}

// 读取 {...} 分组，返回内部的 LaTeXNode 数组（递归解析）
// 调用方需已确认 src[pos] === '{'
function readGroup(state: ParseState): MathComponent[] {
  // 跳过 '{'
  state.pos++
  const components: MathComponent[] = []
  let textBuffer = ''

  const flushText = (): void => {
    if (textBuffer) {
      components.push(new MathRun(textBuffer))
      textBuffer = ''
    }
  }

  while (state.pos < state.src.length && state.src[state.pos] !== '}') {
    const ch = state.src[state.pos]
    if (ch === '\\') {
      flushText()
      const comp = readCommand(state)
      if (comp) components.push(...comp)
    } else if (ch === '{') {
      flushText()
      components.push(...readGroup(state))
    } else if (ch === '^' || ch === '_') {
      // 上下标需要结合前面的 base
      flushText()
      const last = components.length > 0 ? components.pop()! : new MathRun('')
      handleScript(state, last, components)
    } else {
      textBuffer += ch
      state.pos++
    }
  }
  flushText()
  // 跳过 '}'
  if (state.pos < state.src.length && state.src[state.pos] === '}') state.pos++
  return components
}

// 读取单个"原子"作为上下标的脚本内容：
//   {expr} → 解析整组
//   \foo   → 单个命令（Greek/symbol/frac 等）
//   单字符 → 单字符
function readScriptContent(state: ParseState): MathComponent[] {
  skipSpaces(state)
  const ch = state.src[state.pos]
  if (ch === '{') {
    return readGroup(state)
  }
  if (ch === '\\') {
    return readCommand(state) ?? [new MathRun('')]
  }
  if (ch === undefined) return [new MathRun('')]
  // 单字符（含数字串，方便 x^2、x^{10}）
  let str = ''
  while (state.pos < state.src.length) {
    const c = state.src[state.pos]
    if (/[0-9]/.test(c)) {
      str += c
      state.pos++
    } else {
      break
    }
  }
  if (!str) {
    str = state.src[state.pos]
    state.pos++
  }
  return [new MathRun(str)]
}

function skipSpaces(state: ParseState): void {
  while (state.pos < state.src.length && /\s/.test(state.src[state.pos])) state.pos++
}

// 处理紧贴 base 的 ^ / _（可能同时存在 _^ 或 ^_）
// base 是已有的 MathComponent，将其包装为 Super/Sub/SubSuper
function handleScript(
  state: ParseState,
  base: MathComponent,
  out: MathComponent[]
): void {
  let sub: MathComponent[] | undefined
  let sup: MathComponent[] | undefined
  // 首字符是 _ 或 ^
  while (state.pos < state.src.length && (state.src[state.pos] === '_' || state.src[state.pos] === '^')) {
    const marker = state.src[state.pos]
    state.pos++
    const content = readScriptContent(state)
    if (marker === '^') sup = content
    else sub = content
    skipSpaces(state)
  }
  if (sub && sup) {
    out.push(new MathSubSuperScript({ children: [base], subScript: sub, superScript: sup }))
  } else if (sup) {
    out.push(new MathSuperScript({ children: [base], superScript: sup }))
  } else if (sub) {
    out.push(new MathSubScript({ children: [base], subScript: sub }))
  } else {
    // 没有 _ 或 ^（理论不会到这），原样归还
    out.push(base)
  }
}

// 读取一个 LaTeX 命令，返回对应的 MathComponent[]
// 调用方需已确认 src[pos] === '\\'
function readCommand(state: ParseState): MathComponent[] | null {
  state.pos++ // 跳过 '\'
  // 单字符转义：\{ \} \% \# \& \\ \, \: \; \! 等
  const next = state.src[state.pos]
  if (next && !/[a-zA-Z]/.test(next)) {
    state.pos++
    const mapped = SYMBOL_MAP[next]
    if (mapped !== undefined) return [new MathRun(mapped)]
    if (next === '{' || next === '}') return [new MathRun(next)]
    return [new MathRun(next)]
  }
  // 读命令名
  let name = ''
  while (state.pos < state.src.length && /[a-zA-Z]/.test(state.src[state.pos])) {
    name += state.src[state.pos]
    state.pos++
  }
  // 处理 \left( \right) 等定界符命令
  if (name === 'left' || name === 'right') {
    // 后面应该跟一个定界符字符
    skipSpaces(state)
    const delim = state.src[state.pos]
    if (delim) {
      state.pos++
      if (delim === '.') return []
      return [new MathRun(delim)]
    }
    return []
  }

  if (name === 'frac' || name === 'dfrac' || name === 'tfrac') {
    skipSpaces(state)
    const num = state.src[state.pos] === '{' ? readGroup(state) : [new MathRun(state.src[state.pos++] ?? '')]
    skipSpaces(state)
    const den = state.src[state.pos] === '{' ? readGroup(state) : [new MathRun(state.src[state.pos++] ?? '')]
    return [new MathFraction({ numerator: num, denominator: den })]
  }

  if (name === 'sqrt') {
    skipSpaces(state)
    let degree: MathComponent[] | undefined
    // \sqrt[n]{x}
    if (state.src[state.pos] === '[') {
      state.pos++
      const degStart = state.pos
      while (state.pos < state.src.length && state.src[state.pos] !== ']') state.pos++
      degree = latexToMathComponents(state.src.slice(degStart, state.pos))
      if (state.src[state.pos] === ']') state.pos++
      skipSpaces(state)
    }
    const body = state.src[state.pos] === '{' ? readGroup(state) : [new MathRun(state.src[state.pos++] ?? '')]
    return [new MathRadical({ children: body, degree })]
  }

  if (name === 'sum' || name === 'prod' || name === 'bigcup' || name === 'bigcap') {
    skipSpaces(state)
    let sub: MathComponent[] | undefined
    let sup: MathComponent[] | undefined
    while (state.pos < state.src.length && (state.src[state.pos] === '_' || state.src[state.pos] === '^')) {
      const marker = state.src[state.pos]
      state.pos++
      const content = readScriptContent(state)
      if (marker === '_') sub = content
      else sup = content
      skipSpaces(state)
    }
    // 读 body（直到下一个顶层 & 或 \\ 或行尾）
    const body = readUntilRelOrEnd(state)
    if (name === 'sum') {
      return [new MathSum({ children: body, subScript: sub, superScript: sup })]
    }
    // prod / bigcup / bigcap 退化为带上下标的 ∏/⋃/⋂ 字符
    const sym = SYMBOL_MAP[name] || ''
    const base: MathComponent = new MathRun(sym)
    if (sub && sup) return [new MathSubSuperScript({ children: [base], subScript: sub, superScript: sup }), ...body]
    if (sup) return [new MathSuperScript({ children: [base], superScript: sup }), ...body]
    if (sub) return [new MathSubScript({ children: [base], subScript: sub }), ...body]
    return [base, ...body]
  }

  if (name === 'int' || name === 'oint') {
    skipSpaces(state)
    let sub: MathComponent[] | undefined
    let sup: MathComponent[] | undefined
    while (state.pos < state.src.length && (state.src[state.pos] === '_' || state.src[state.pos] === '^')) {
      const marker = state.src[state.pos]
      state.pos++
      const content = readScriptContent(state)
      if (marker === '_') sub = content
      else sup = content
      skipSpaces(state)
    }
    const body = readUntilRelOrEnd(state)
    return [new MathIntegral({ children: body, subScript: sub, superScript: sup })]
  }

  // 已知符号命令
  if (name in SYMBOL_MAP) {
    const sym = SYMBOL_MAP[name]
    if (sym === '' ) return [] // 空命令（如 \displaystyle）
    if (sym === 'frac' || sym === 'sqrt') return [] // 不会到这，防御
    return [new MathRun(sym)]
  }

  // \text{...} / \mathrm{...} / \textbf{...} 等字面文本命令
  if (name.startsWith('text') || name === 'mathrm' || name === 'mathit' || name === 'mathbf' || name === 'operatorname') {
    skipSpaces(state)
    if (state.src[state.pos] === '{') {
      const inner = readGroup(state)
      return inner
    }
    return []
  }

  // 未知命令：去掉反斜杠，把名字当文本输出，避免丢内容
  if (name) return [new MathRun(name)]
  return []
}

// 读取直到顶层 & / \\ / 行尾，作为大型运算符的 body
function readUntilRelOrEnd(state: ParseState): MathComponent[] {
  const components: MathComponent[] = []
  let textBuffer = ''
  const flushText = (): void => {
    if (textBuffer) {
      components.push(new MathRun(textBuffer))
      textBuffer = ''
    }
  }
  while (state.pos < state.src.length) {
    const ch = state.src[state.pos]
    if (ch === '&' || ch === '\n') break
    // 检测 \\ （行间换行）
    if (ch === '\\' && state.src[state.pos + 1] === '\\') {
      state.pos += 2
      break
    }
    if (ch === '\\') {
      flushText()
      const comp = readCommand(state)
      if (comp) components.push(...comp)
    } else if (ch === '{') {
      flushText()
      components.push(...readGroup(state))
    } else if (ch === '^' || ch === '_') {
      flushText()
      const last = components.length > 0 ? components.pop()! : new MathRun('')
      handleScript(state, last, components)
    } else {
      textBuffer += ch
      state.pos++
    }
  }
  flushText()
  return components
}

// 入口：把一段 LaTeX 表达式转成 MathComponent 数组
export function latexToMathComponents(latex: string): MathComponent[] {
  const state: ParseState = { src: latex, pos: 0 }
  const components: MathComponent[] = []
  let textBuffer = ''
  const flushText = (): void => {
    if (textBuffer) {
      components.push(new MathRun(textBuffer))
      textBuffer = ''
    }
  }
  while (state.pos < state.src.length) {
    const ch = state.src[state.pos]
    if (ch === '\\') {
      flushText()
      const comp = readCommand(state)
      if (comp) components.push(...comp)
    } else if (ch === '{') {
      flushText()
      components.push(...readGroup(state))
    } else if (ch === '^' || ch === '_') {
      flushText()
      const last = components.length > 0 ? components.pop()! : new MathRun('')
      handleScript(state, last, components)
    } else if (ch === '$') {
      // 嵌套 $ 不应该出现，跳过
      state.pos++
    } else {
      textBuffer += ch
      state.pos++
    }
  }
  flushText()
  return components
}

// 包装为 Docx Math 元素（可放入 Paragraph.children）
export function latexToDocxMath(latex: string): DocxMath {
  return new DocxMath({ children: latexToMathComponents(latex) })
}
