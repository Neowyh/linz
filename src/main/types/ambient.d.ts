// @xenova/transformers 是可选依赖（ESM-only，运行时动态 import）。
// 未安装时提供 ambient 模块声明，避免 tsc 报 TS2307。
declare module '@xenova/transformers' {
  export function pipeline(task: string, model: string, options?: any): Promise<any>
  export const env: any
}
