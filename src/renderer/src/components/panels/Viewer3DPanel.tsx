import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Select, Spin, message } from 'antd'
import { FolderOpenOutlined, PlayCircleOutlined } from '@ant-design/icons'
import vtkSTLReader from '@kitware/vtk.js/IO/Geometry/STLReader'
import vtkOBJReader from '@kitware/vtk.js/IO/Misc/OBJReader'
import MeshCanvasViewer from './MeshCanvasViewer'
import ThreeMeshViewer from './ThreeMeshViewer'
import { b64ToArrayBuffer, b64ToText } from './vtkViewer'
import { usePanelCommandStore } from '../../stores/panelCommandStore'

type Rep = 'surface' | 'wireframe' | 'points'
type Engine = 'three' | 'canvas'

interface MeshData {
  positions: number[]
  indices: number[]
}

function pdToTriangles(pd: any): MeshData {
  const pos = pd.getPoints().getData() as Float32Array
  const polys = pd.getPolys().getData() as Uint32Array
  const positions = Array.from(pos)
  const indices: number[] = []
  let k = 0
  while (k + 1 < polys.length) {
    const count = polys[k]
    k += 1
    for (let j = 0; j < count; j += 1) indices.push(polys[k + j])
    k += count
  }
  return { positions, indices }
}

export default function Viewer3DPanel({
  instanceId,
  panelType
}: {
  instanceId: string
  panelType: string
}): JSX.Element {
  const [relPath, setRelPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [rep, setRep] = useState<Rep>('surface')
  const [engine, setEngine] = useState<Engine>('three')
  const [err, setErr] = useState<string | null>(null)
  const [mesh, setMesh] = useState<MeshData | null>(null)

  const load = useCallback(async () => {
    const path = relPath.trim()
    if (!path) return
    setLoading(true)
    setErr(null)
    try {
      const ext = path.split('.').pop()?.toLowerCase()
      let data: MeshData
      if (ext === 'stp' || ext === 'step') {
        // STEP：主进程 OpenCASCADE WASM 转网格
        const res = await window.aeromind.step.readMesh(path)
        if (!res.success) {
          setErr(res.error)
          message.error(`STEP 打开失败: ${res.error}`)
          return
        }
        data = { positions: res.positions, indices: res.indices }
      } else {
        const res = await window.aeromind.files.readBinary(path)
        if ('error' in res) {
          message.error(res.error)
          return
        }
        let pd: any
        if (ext === 'stl') {
          const r = vtkSTLReader.newInstance()
          await r.parseAsArrayBuffer(b64ToArrayBuffer(res.data))
          pd = r.getOutputData(0)
        } else if (ext === 'obj') {
          const r = vtkOBJReader.newInstance()
          await r.parseAsText(b64ToText(res.data))
          pd = r.getOutputData(0)
        } else {
          throw new Error('仅支持 STL / OBJ / STP / STEP 格式')
        }
        data = pdToTriangles(pd)
      }
      setMesh(data)
    } catch (e) {
      setErr((e as Error).message || String(e))
      message.error('加载失败: ' + ((e as Error).message || String(e)))
    } finally {
      setLoading(false)
    }
  }, [relPath])

  // 对话→面板联动：按命令 payload.path 直接加载（绕过 relPath state 的异步更新，
  // 避免 setState 未生效就 load 导致空跑）。用 ref 持有最新实现，订阅 effect 不必依赖它。
  const loadCommandRef = useRef<(path: string) => Promise<void>>(async () => {})
  loadCommandRef.current = async (path): Promise<void> => {
    if (!path) return
    setLoading(true)
    setErr(null)
    setRelPath(path)
    try {
      const ext = path.split('.').pop()?.toLowerCase()
      let data: MeshData
      if (ext === 'stp' || ext === 'step') {
        const res = await window.aeromind.step.readMesh(path)
        if (!res.success) {
          setErr(res.error)
          message.error(`STEP 打开失败: ${res.error}`)
          return
        }
        data = { positions: res.positions, indices: res.indices }
      } else {
        const res = await window.aeromind.files.readBinary(path)
        if ('error' in res) {
          message.error(res.error)
          return
        }
        let pd: any
        if (ext === 'stl') {
          const r = vtkSTLReader.newInstance()
          await r.parseAsArrayBuffer(b64ToArrayBuffer(res.data))
          pd = r.getOutputData(0)
        } else if (ext === 'obj') {
          const r = vtkOBJReader.newInstance()
          await r.parseAsText(b64ToText(res.data))
          pd = r.getOutputData(0)
        } else {
          throw new Error('仅支持 STL / OBJ / STP / STEP 格式')
        }
        data = pdToTriangles(pd)
      }
      setMesh(data)
    } catch (e) {
      setErr((e as Error).message || String(e))
      message.error('加载失败: ' + ((e as Error).message || String(e)))
    } finally {
      setLoading(false)
    }
  }

  // 对话→面板联动：订阅 panelCommandStore 里属于 viewer3d 面板的命令，
  // 收到 load/open action 时按 payload.path 自动加载（STL/OBJ/STP/STEP）。
  useEffect(() => {
    if (panelType !== 'viewer3d') return
    const handled = new Set<string>()
    const unsub = usePanelCommandStore.subscribe((state, prev) => {
      if (state.pending === prev.pending) return
      for (const cmd of state.pending) {
        if (cmd.panelType !== 'viewer3d') continue
        if (cmd.instanceId && cmd.instanceId !== instanceId) continue
        if (cmd.action !== 'load' && cmd.action !== 'open') continue
        if (handled.has(cmd.id)) continue
        handled.add(cmd.id)
        const path = typeof cmd.payload.path === 'string' ? cmd.payload.path.trim() : ''
        void loadCommandRef.current(path).finally(() => {
          usePanelCommandStore.getState().consume(cmd.id)
        })
      }
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelType, instanceId])

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0">
        <div className="flex gap-2">
          <Input
            value={relPath}
            onChange={(e) => setRelPath(e.target.value)}
            onPressEnter={() => void load()}
            placeholder="工作空间内相对路径，如 meshes/wing.stl 或 part.stp"
            prefix={<FolderOpenOutlined />}
            size="small"
          />
          <Button size="small" type="primary" onClick={() => void load()} loading={loading} icon={<PlayCircleOutlined />}>
            打开
          </Button>
          <Select
            size="small"
            value={rep}
            onChange={(v) => setRep(v as Rep)}
            options={[
              { value: 'surface', label: '实体' },
              { value: 'wireframe', label: '线框' },
              { value: 'points', label: '点云' }
            ]}
            style={{ width: 84 }}
          />
          <Select
            size="small"
            value={engine}
            onChange={(v) => setEngine(v as Engine)}
            options={[
              { value: 'three', label: 'Three 3D' },
              { value: 'canvas', label: '软件 2D' }
            ]}
            style={{ width: 96 }}
          />
        </div>
        <p className="text-[10px] text-gray-400 mt-1 leading-tight">
          拖拽旋转 / 滚轮缩放 · STEP/STL/OBJ · Three 若黑屏可切「软件 2D」
        </p>
      </div>
      <div className="flex-1 min-h-0 relative">
        {mesh ? (
          engine === 'three' ? (
            <ThreeMeshViewer
              positions={mesh.positions}
              indices={mesh.indices}
              representation={rep}
              onFail={() => {
                if (engine === 'three') {
                  setEngine('canvas')
                  message.info('WebGL 不可用，已切换到软件渲染')
                }
              }}
            />
          ) : (
            <MeshCanvasViewer positions={mesh.positions} indices={mesh.indices} representation={rep} />
          )
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-400" style={{ background: '#171a22' }}>
            {loading ? (
              <>
                <Spin />
                <span className="text-xs">解析模型中…</span>
              </>
            ) : err ? (
              <span className="text-xs text-red-300 px-4 text-center">{err}</span>
            ) : (
              <span className="text-xs">输入工作空间内文件路径后点「打开」</span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}