import { DynamicTool } from '@langchain/core/tools'

// 安全的数学表达式求值器 — 使用递归下降解析器，不使用 eval / Function 构造器

// 白名单函数映射
const MATH_FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan,
  asin: Math.asin, acos: Math.acos, atan: Math.atan,
  sqrt: Math.sqrt, abs: Math.abs,
  log: Math.log, log2: Math.log2, log10: Math.log10,
  exp: Math.exp, pow: Math.pow,
  ceil: Math.ceil, floor: Math.floor, round: Math.round
}

const MATH_CONSTANTS: Record<string, number> = {
  PI: Math.PI, E: Math.E
}

// Token 类型
type TokenType = 'number' | 'operator' | 'function' | 'constant' | 'lparen' | 'rparen' | 'comma'

interface Token {
  type: TokenType
  value: string
}

function tokenize(expr: string): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (/\s/.test(ch)) { i++; continue }
    if (/[0-9.]/.test(ch)) {
      let num = ''
      while (i < expr.length && /[0-9.eE+\-]/.test(expr[i])) {
        // Handle scientific notation: only allow +/- after e/E
        if ((expr[i] === '+' || expr[i] === '-') && num.length > 0 && !/[eE]$/.test(num)) break
        num += expr[i]; i++
      }
      tokens.push({ type: 'number', value: num })
    } else if (/[+\-*/%^]/.test(ch)) {
      tokens.push({ type: 'operator', value: ch }); i++
    } else if (ch === '(') {
      tokens.push({ type: 'lparen', value: ch }); i++
    } else if (ch === ')') {
      tokens.push({ type: 'rparen', value: ch }); i++
    } else if (ch === ',') {
      tokens.push({ type: 'comma', value: ch }); i++
    } else if (/[a-zA-Z_]/.test(ch)) {
      let name = ''
      while (i < expr.length && /[a-zA-Z0-9_]/.test(expr[i])) {
        name += expr[i]; i++
      }
      if (MATH_FUNCTIONS[name]) {
        tokens.push({ type: 'function', value: name })
      } else if (MATH_CONSTANTS[name] !== undefined) {
        tokens.push({ type: 'constant', value: name })
      } else {
        throw new Error(`未识别的标识符: ${name}`)
      }
    } else {
      throw new Error(`不支持的字符: ${ch}`)
    }
  }
  return tokens
}

class Parser {
  private tokens: Token[]
  private pos = 0

  constructor(tokens: Token[]) {
    this.tokens = tokens
  }

  private peek(): Token | null {
    return this.pos < this.tokens.length ? this.tokens[this.pos] : null
  }

  private consume(): Token {
    const t = this.tokens[this.pos++]
    if (!t) throw new Error('意外的表达式结尾')
    return t
  }

  // expression = term (('+' | '-') term)*
  parse(): number {
    let result = this.parseTerm()
    while (true) {
      const t = this.peek()
      if (t && t.type === 'operator' && (t.value === '+' || t.value === '-')) {
        this.consume()
        const right = this.parseTerm()
        if (t.value === '+') result = result + right
        else result = result - right
      } else break
    }
    return result
  }

  // term = factor (('*' | '/' | '%') factor)*
  private parseTerm(): number {
    let result = this.parseFactor()
    while (true) {
      const t = this.peek()
      if (t && t.type === 'operator' && (t.value === '*' || t.value === '/' || t.value === '%')) {
        this.consume()
        const right = this.parseFactor()
        if (t.value === '*') result = result * right
        else if (t.value === '/') {
          if (right === 0) throw new Error('除以零')
          result = result / right
        } else {
          result = result % right
        }
      } else break
    }
    return result
  }

  // factor = ('+' | '-')? power
  private parseFactor(): number {
    const t = this.peek()
    if (t && t.type === 'operator' && (t.value === '+' || t.value === '-')) {
      this.consume()
      const val = this.parsePower()
      return t.value === '-' ? -val : val
    }
    return this.parsePower()
  }

  // power = atom ('^' | '**') power — right-associative
  // 注意：tokenizer 把 '**' 拆成两个 '*' token，需向前看一位区分乘法与幂
  private parsePower(): number {
    let base = this.parseAtom()
    const t = this.peek()
    if (t && t.type === 'operator') {
      if (t.value === '^') {
        this.consume()
        const exp = this.parsePower()
        return Math.pow(base, exp)
      }
      if (t.value === '*' && this.tokens[this.pos + 1]?.value === '*') {
        this.consume() // 第一个 *
        this.consume() // 第二个 *
        const exp = this.parsePower()
        return Math.pow(base, exp)
      }
    }
    return base
  }

  // atom = number | constant | function '(' args ')' | '(' expression ')'
  private parseAtom(): number {
    const t = this.peek()
    if (!t) throw new Error('意外的表达式结尾')

    if (t.type === 'number') {
      this.consume()
      const val = parseFloat(t.value)
      if (isNaN(val)) throw new Error(`无效数字: ${t.value}`)
      return val
    }

    if (t.type === 'constant') {
      this.consume()
      return MATH_CONSTANTS[t.value]
    }

    if (t.type === 'function') {
      this.consume()
      const funcName = t.value
      const next = this.peek()
      if (!next || next.type !== 'lparen') throw new Error(`函数 ${funcName} 后缺少括号`)
      this.consume() // consume '('

      const args: number[] = []
      if (this.peek()?.type !== 'rparen') {
        args.push(this.parse())
        while (this.peek()?.type === 'comma') {
          this.consume()
          args.push(this.parse())
        }
      }

      const closeParen = this.peek()
      if (!closeParen || closeParen.type !== 'rparen') throw new Error('缺少右括号')
      this.consume()

      const fn = MATH_FUNCTIONS[funcName]
      return fn(...args)
    }

    if (t.type === 'lparen') {
      this.consume()
      const result = this.parse()
      const close = this.peek()
      if (!close || close.type !== 'rparen') throw new Error('缺少右括号')
      this.consume()
      return result
    }

    throw new Error(`意外的 token: ${t.type}(${t.value})`)
  }
}

function safeEvaluate(expr: string): number {
  const prepared = expr.replace(/\^/g, '**').replace(/π/g, 'PI').replace(/pi\b/gi, 'PI')
  const tokens = tokenize(prepared)
  const parser = new Parser(tokens)
  const result = parser.parse()
  if (typeof result !== 'number' || isNaN(result)) {
    throw new Error('计算结果不是有效数值')
  }
  return result
}

export const calculatorTool = new DynamicTool({
  name: 'calculator',
  description: '计算数学表达式。输入一个数学表达式字符串，返回计算结果。支持基本运算、三角函数、对数、指数等。例如: "0.5 * 1.225 * 70**2 * 20 * 0.5" 或 "sin(0.1) * 180 / PI"',
  func: async (input: string): Promise<string> => {
    try {
      const result = safeEvaluate(input.trim())
      if (!isFinite(result)) {
        return '错误: 计算结果为无穷大或非数值，请检查输入参数'
      }
      return String(result)
    } catch (err: any) {
      return `计算错误: ${err.message || String(err)}`
    }
  }
})
