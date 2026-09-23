// 把任意值安全地转成可直接渲染的字符串。
// 历史数据 / 导入数据里某些"本应是字符串"的字段可能存成了对象（如 { name: "气动" }），
// 直接 {value} 渲染会触发 React "Objects are not valid as a React child" 致命错误并白屏。
// 这里统一兜底：对象取 name/id/label/value，其余 String() 化。
export function asText(value: unknown): string {
  if (value == null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if (typeof obj.name === 'string') return obj.name
    if (typeof obj.id === 'string') return obj.id
    if (typeof obj.label === 'string') return obj.label
    if (typeof obj.value === 'string') return obj.value
    try {
      return JSON.stringify(obj)
    } catch {
      return '[object]'
    }
  }
  return String(value)
}

// 把存成 JSON 字符串的"本应是字符串数组"的字段解析为 string[]，并强制把
// 每个元素规整为字符串（历史/导入数据里可能混入 { name: "x" } 之类的对象，
// 原样 .map 渲染会触发 React 致命错误）。空元素一并丢弃。
export function parseStringArray(raw: unknown): string[] {
  let arr: unknown
  try {
    arr = JSON.parse(typeof raw === 'string' ? raw : '[]')
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  return arr
    .map(asText)
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter((s) => s.length > 0)
}
