import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Input, Select, Spin, message } from 'antd'
import { FolderOpenOutlined, PlayCircleOutlined } from '@ant-design/icons'
import { parseTecplotAscii, type ParsedTecplot, type TecplotZone } from './tecplot-reader'
import {
  createVtkViewport,
  buildStructuredPolydata,
  makeColorTransfer,
  makeFieldActor,
  makeScalarBar,
  setRepresentation,
  render,
  b64ToText,
  type VtkViewport,
  type TecplotGrid
} from './vtkViewer'
import { usePanelCommandStore } from '../../stores/panelCommandStore'

type Rep = 'surface' | 'wireframe' | 'points'

function toGrid(zone: TecplotZone, variables: string[]): TecplotGrid | null {
  if (variables.length < 3) return null
  const first3 = variables.slice(0, 3).map((v) => v.toLowerCase())
  if (!['x', 'y', 'z'].every((c) => first3.includes(c))) return null
  const N = zone.data[0].length
  const xyz = new Float32Array(N * 3)
  for (let n = 0; n < N; n += 1) {
    xyz[n * 3] = zone.data[0][n]
    xyz[n * 3 + 1] = zone.data[1][n]
    xyz[n * 3 + 2] = zone.data[2][n]
  }
  const vars: Record<string, Float32Array> = {}
  for (let v = 3; v < variables.length; v += 1) {
    vars[variables[v]] = Float32Array.from(zone.data[v])
  }
  return { xyz, dims: zone.dims, vars }
}

export default function SolverResultsPanel({
  instanceId,
  panelType
}: {
  instanceId: string
  panelType: string
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const vpRef = useRef<VtkViewport | null>(null)
  const dsRef = useRef<any>(null)
  const actorRef = useRef<any>(null)
  const mapperRef = useRef<any>(null)
  const ctfRef = useRef<any>(null)
  const scalarBarRef = useRef<any>(null)
  const repRef = useRef<Rep>('surface')

  const [relPath, setRelPath] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [parsed, setParsed] = useState<ParsedTecplot | null>(null)
  const [zoneIndex, setZoneIndex] = useState(0)
  const [activeVar, setActiveVar] = useState('')
  const [rep, setRep] = useState<Rep>('surface')

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let vp: VtkViewport
    try {
      vp = createVtkViewport(container, [0.09, 0.1, 0.13])
    } catch (e) {
      setErr('WebGL 初始化失败（软渲染环境可能受限）: ' + (e as Error).message)
      return
    }
    vpRef.current = vp
    ctfRef.current = makeColorTransfer()
    const ro = new ResizeObserver(() => vp.resize())
    ro.observe(container)
    return () => {
      ro.disconnect()
      vp.destroy()
      vpRef.current = null
    }
  }, [])

  const clearScene = useCallback((vp: VtkViewport) => {
    if (actorRef.current) {
      try {
        vp.renderer.removeActor(actorRef.current)
      } catch {
        // 忽略
      }
    }
    if (scalarBarRef.current) {
      try {
        vp.renderer.removeActor(scalarBarRef.current)
      } catch {
        // 忽略
      }
    }
    actorRef.current = null
    scalarBarRef.current = null
    dsRef.current = null
    mapperRef.current = null
  }, [])

  const applyZone = useCallback(
    (z: TecplotZone, variables: string[], varName: string) => {
      const vp = vpRef.current
      if (!vp) return
      const grid = toGrid(z, variables)
      if (!grid) {
        setErr('该 zone 未识别到坐标变量（x/y/z），暂无法显示')
        return
      }
      const ds = buildStructuredPolydata(grid, varName)
      const ctf = ctfRef.current ?? makeColorTransfer()
      const { mapper, actor, range } = makeFieldActor(ds, ctf)
      const scalarBar = makeScalarBar(ctf)
      clearScene(vp)
      setRepresentation(actor, repRef.current)
      vp.renderer.addActor(actor)
      vp.renderer.addActor(scalarBar)
      actorRef.current = actor
      mapperRef.current = mapper
      scalarBarRef.current = scalarBar
      dsRef.current = ds
      setErr(null)
      render(vp)
      void range
    },
    [clearScene]
  )

  const load = useCallback(async () => {
    const path = relPath.trim()
    if (!path) return
    setLoading(true)
    setErr(null)
    try {
      const res = await window.aeromind.files.readBinary(path)
      if ('error' in res) {
        message.error(res.error)
        return
      }
      const p = parseTecplotAscii(b64ToText(res.data))
      if (p.zones.length === 0) {
        message.error('未能解析出 Zone（仅支持结构化 IJK 的 Tecplot ASCII .dat）')
        return
      }
      setParsed(p)
      setZoneIndex(0)
      const scalarVars = p.variables.slice(3)
      setActiveVar(scalarVars[0] ?? '')
      applyZone(p.zones[0], p.variables, scalarVars[0] ?? '')
    } catch (e) {
      setErr((e as Error).message || String(e))
      message.error('加载失败: ' + ((e as Error).message || String(e)))
    } finally {
      setLoading(false)
    }
  }, [relPath, applyZone])

  // 对话→面板联动：按命令 payload 直接加载（绕过 relPath state 的异步更新，
  // 避免 setState 未生效就 load 导致空跑）。用 ref 持有最新实现，订阅 effect 不必依赖它。
  const loadCommandRef = useRef<(path: string, zone?: string, variable?: string) => Promise<void>>(
    async () => {}
  )
  loadCommandRef.current = async (path, zone, variable): Promise<void> => {
    if (!path) return
    setLoading(true)
    setErr(null)
    setRelPath(path)
    try {
      const res = await window.aeromind.files.readBinary(path)
      if ('error' in res) {
        message.error(res.error)
        return
      }
      const p = parseTecplotAscii(b64ToText(res.data))
      if (p.zones.length === 0) {
        message.error('未能解析出 Zone（仅支持结构化 IJK 的 Tecplot ASCII .dat）')
        return
      }
      setParsed(p)
      const zIdx = zone != null ? Number(zone) : 0
      const zi = Number.isNaN(zIdx) ? 0 : zIdx
      setZoneIndex(zi)
      const scalarVars = p.variables.slice(3)
      const v0 = variable && scalarVars.includes(variable) ? variable : (scalarVars[0] ?? '')
      setActiveVar(v0)
      applyZone(p.zones[zi] ?? p.zones[0], p.variables, v0)
    } catch (e) {
      setErr((e as Error).message || String(e))
      message.error('加载失败: ' + ((e as Error).message || String(e)))
    } finally {
      setLoading(false)
    }
  }

  // 对话→面板联动：订阅 panelCommandStore 里属于 field 面板的命令，
  // 收到 action='load'（默认）时按 payload.path 自动加载，可附带 zone/var 选择。
  useEffect(() => {
    if (panelType !== 'field') return
    const handled = new Set<string>()
    const unsub = usePanelCommandStore.subscribe((state, prev) => {
      if (state.pending === prev.pending) return
      for (const cmd of state.pending) {
        if (cmd.panelType !== 'field') continue
        if (cmd.instanceId && cmd.instanceId !== instanceId) continue
        if (cmd.action !== 'load' && cmd.action !== 'open') continue
        if (handled.has(cmd.id)) continue
        handled.add(cmd.id)
        const path = typeof cmd.payload.path === 'string' ? cmd.payload.path.trim() : ''
        const zone = typeof cmd.payload.zone === 'string' ? cmd.payload.zone : undefined
        const variable = typeof cmd.payload.var === 'string' ? cmd.payload.var : undefined
        void loadCommandRef.current(path, zone, variable).finally(() => {
          usePanelCommandStore.getState().consume(cmd.id)
        })
      }
    })
    return () => unsub()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panelType, instanceId])

  const switchZone = useCallback(
    (idx: number) => {
      if (!parsed || idx < 0 || idx >= parsed.zones.length) return
      setZoneIndex(idx)
      const v = activeVar || parsed.variables[3]
      applyZone(parsed.zones[idx], parsed.variables, v)
    },
    [parsed, activeVar, applyZone]
  )

  const switchVar = useCallback(
    (v: string) => {
      setActiveVar(v)
      const ds = dsRef.current
      const mapper = mapperRef.current
      if (ds && mapper) {
        ds.getPointData().setActiveScalars(v)
        const r = ds.getPointData().getScalars().getRange()
        mapper.setScalarRange(r[0], r[1])
        const vp = vpRef.current
        if (vp) vp.renderWindow.render()
      } else if (parsed) {
        applyZone(parsed.zones[zoneIndex], parsed.variables, v)
      }
    },
    [parsed, zoneIndex, applyZone]
  )

  const applyRep = useCallback((next: Rep) => {
    setRep(next)
    repRef.current = next
    if (actorRef.current) setRepresentation(actorRef.current, next)
    const vp = vpRef.current
    if (vp) vp.renderWindow.render()
  }, [])

  const zones = parsed?.zones ?? []
  const scalarVars = parsed?.variables.slice(3) ?? []

  return (
    <div className="h-full flex flex-col bg-white overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-200 bg-gray-50 flex-shrink-0 space-y-1.5">
        <div className="flex gap-2">
          <Input
            value={relPath}
            onChange={(e) => setRelPath(e.target.value)}
            onPressEnter={() => void load()}
            placeholder="Tecplot ASCII .dat 相对路径，如 results/slice.dat"
            prefix={<FolderOpenOutlined />}
            size="small"
          />
          <Button size="small" type="primary" onClick={() => void load()} loading={loading} icon={<PlayCircleOutlined />}>
            打开
          </Button>
        </div>
        {zones.length > 0 && (
          <div className="flex gap-2 items-center">
            <Select
              size="small"
              value={zoneIndex}
              onChange={(v) => switchZone(Number(v))}
              options={zones.map((z, i) => ({
                value: i,
                label: `${z.name} (${z.dims[0]}x${z.dims[1]}x${z.dims[2]})`
              }))}
              style={{ flex: 1, minWidth: 0 }}
              placeholder="Zone"
            />
            <Select
              size="small"
              value={activeVar}
              onChange={(v) => switchVar(v)}
              options={scalarVars.map((v) => ({ value: v, label: v }))}
              style={{ flex: 1, minWidth: 0 }}
              placeholder="变量"
            />
            <Select
              size="small"
              value={rep}
              onChange={(v) => applyRep(v as Rep)}
              options={[
                { value: 'surface', label: '实体' },
                { value: 'wireframe', label: '线框' },
                { value: 'points', label: '点云' }
              ]}
              style={{ width: 84 }}
            />
          </div>
        )}
        <p className="text-[10px] text-gray-400 leading-tight">
          v1：结构化 IJK 网格 + 标量着色/切片面/等值面示意色标 · 等值面/流线/体积渲染后续
        </p>
      </div>
      <div ref={containerRef} className="flex-1 min-h-0 relative" style={{ background: '#171a22' }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <Spin />
          </div>
        )}
        {err && (
          <div className="absolute inset-0 flex items-center justify-center text-xs text-red-300 p-4 text-center">
            {err}
          </div>
        )}
      </div>
    </div>
  )
}
