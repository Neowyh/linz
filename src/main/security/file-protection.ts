// 文件防护：用户在设置中添加受保护的敏感文件/目录路径。
// Agent 工具在访问任何文件前必须过 checkPathAllowed（工具级）或 getBlockedByArgs（中央安全门），
// 命中受保护路径则直接拦截，并在对话框中以工具卡片形式提示。
import * as path from 'path'
import { getAppConfig } from '../store/app-config'

// 规范化：解析为绝对路径 + 统一正斜杠 + 去尾斜杠
export function normalizePath(p: string): string {
  const resolved = path.resolve(p)
  const normalized = resolved.replace(/\\/g, '/').replace(/\/+$/, '')
  return normalized || '/'
}

export function getProtectedPaths(): string[] {
  const cfg = getAppConfig()
  const list = cfg.get('protectedPaths') || []
  return list.filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
}

// 命中判断：target 自身或任一父级在保护列表内（Windows 路径大小写不敏感）
// 返回命中的受保护路径（原样），未命中返回 null
export function matchProtectedPath(target: string): string | null {
  const t = normalizePath(target).toLowerCase()
  for (const p of getProtectedPaths()) {
    const n = normalizePath(p).toLowerCase()
    if (n && (t === n || t.startsWith(n + '/'))) return p
  }
  return null
}

export function checkPathAllowed(target: string): { ok: boolean; protectedPath?: string } {
  const hit = matchProtectedPath(target)
  return hit ? { ok: false, protectedPath: hit } : { ok: true }
}

// 递归提取参数中的 Windows 绝对路径（C:\... 或 C:/... 或 \\server\share\...）
function collectAbsolutePaths(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (/^[A-Za-z]:[\\/]/.test(value) || value.startsWith('\\\\')) out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const v of value) collectAbsolutePaths(v, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectAbsolutePaths(v, out)
  }
  return out
}

// 供中央安全门在任意工具调用前检查：参数中任一绝对路径命中受保护路径即拦截
// （相对路径由各工具 resolve 后走 checkPathAllowed 兜底）
export function getBlockedByArgs(args: unknown): { path: string; protectedPath: string } | null {
  const paths = collectAbsolutePaths(args)
  for (const p of paths) {
    const hit = matchProtectedPath(p)
    if (hit) return { path: p, protectedPath: hit }
  }
  return null
}

// 添加受保护路径（规范化 + 去重，幂等）
export function addProtectedPath(p: string): { success: boolean; error?: string } {
  const trimmed = (p || '').trim()
  if (!trimmed) return { success: false, error: '路径不能为空' }
  const cfg = getAppConfig()
  const list = getProtectedPaths()
  const norm = normalizePath(trimmed)
  if (list.some((x) => normalizePath(x).toLowerCase() === norm.toLowerCase())) {
    return { success: true }
  }
  cfg.set('protectedPaths', [...list, norm])
  return { success: true }
}

export function removeProtectedPath(p: string): { success: boolean } {
  const cfg = getAppConfig()
  const list = getProtectedPaths()
  const norm = normalizePath(p)
  cfg.set('protectedPaths', list.filter((x) => normalizePath(x).toLowerCase() !== norm.toLowerCase()))
  return { success: true }
}
