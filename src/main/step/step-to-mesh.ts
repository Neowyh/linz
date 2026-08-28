import { getOcct } from './occt-loader'

export interface StepMeshData {
  success: true
  /** 三角面顶点坐标（xyz 平铺） */
  positions: number[]
  /** 三角面索引（每 3 个编一个三角形） */
  indices: number[]
  /** 网格/部件数量 */
  meshCount: number
  vertexCount: number
}
export type StepMeshResult = StepMeshData | { success: false; error: string }

/** STEP 三角化：读取 buffer，返回可安全过 IPC 的网格数据（法线丢弃，索引转普通数组） */
export async function stepToMesh(buffer: ArrayBuffer | Buffer): Promise<StepMeshResult> {
  let occt: any
  try {
    occt = await getOcct()
  } catch (e: any) {
    return { success: false, error: e?.message || String(e) }
  }

  try {
    const content = occt.ReadStepFile(buffer, null)
    if (!content || content.success === false) {
      return {
        success: false,
        error: content?.error || 'STEP 解析失败（可能是 ASCII/AP 版本不支持或文件损坏）'
      }
    }
    if (!Array.isArray(content.meshes) || content.meshes.length === 0) {
      return { success: false, error: 'STEP 中未解析出可显示的几何' }
    }

    // 合并所有 mesh 的顶点/索引（各 mesh 顶点各自从 0 开始，需做偏移）
    let positions: number[] = []
    let indices: number[] = []
    let vertexCount = 0
    let meshCount = 0
    for (const mesh of content.meshes) {
      if (!mesh || !mesh.attributes || !mesh.attributes.position || !mesh.index) continue
      const pos = mesh.attributes.position.array
      const idx = mesh.index.array
      if (pos.length < 3 || idx.length < 3) continue
      const base = vertexCount
      for (let i = 0; i < pos.length; i += 1) positions.push(pos[i])
      for (let i = 0; i < idx.length; i += 1) indices.push(base + idx[i])
      vertexCount += pos.length / 3
      meshCount += 1
    }
    if (positions.length === 0 || indices.length === 0) {
      return { success: false, error: 'STEP 三角化后无有效网格' }
    }
    return { success: true, positions, indices, meshCount, vertexCount }
  } catch (e: any) {
    return { success: false, error: `STEP 转换失败: ${e?.message || String(e)}` }
  }
}
