import { ipcMain } from 'electron'
import * as fs from 'fs'
import { getFileWorkspacePath } from '../store/app-config'
import { resolveWithinRoot } from '../fs/path-guard'
import { stepToMesh, type StepMeshResult } from '../step/step-to-mesh'

const STEP_EXTS = new Set(['.stp', '.step'])

export function registerStepIPC(): void {
  // 读 STEP 文件并三角化成网格（positions+indices），供三维面板显示
  ipcMain.handle(
    'step:readMesh',
    async (_event, relPath: string): Promise<StepMeshResult> => {
      const root = getFileWorkspacePath()
      if (!root) return { success: false, error: '未设置工作空间目录，请先选择文件夹' }
      const checked = resolveWithinRoot(String(relPath ?? ''), root)
      if (!checked.ok) return { success: false, error: checked.error! }
      const abs = checked.resolved!
      let stat: fs.Stats
      try {
        stat = fs.statSync(abs)
      } catch {
        return { success: false, error: '文件不存在' }
      }
      if (!stat.isFile()) return { success: false, error: '目标不是文件' }
      const ext = abs.slice(abs.lastIndexOf('.')).toLowerCase()
      if (!STEP_EXTS.has(ext)) {
        return { success: false, error: `不支持的文件类型：${ext}（仅支持 .stp / .step）` }
      }
      if (stat.size > 100 * 1024 * 1024) return { success: false, error: 'STEP 文件过大（>100MB）' }
      try {
        const buf = fs.readFileSync(abs)
        return await stepToMesh(buf)
      } catch (e: any) {
        return { success: false, error: `读取失败: ${e?.message || String(e)}` }
      }
    }
  )
}
