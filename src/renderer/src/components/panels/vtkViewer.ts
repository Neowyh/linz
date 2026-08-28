import vtkGenericRenderWindow from '@kitware/vtk.js/Rendering/Misc/GenericRenderWindow'
import vtkInteractorStyleTrackballCamera from '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera'
import vtkMapper from '@kitware/vtk.js/Rendering/Core/Mapper'
import vtkActor from '@kitware/vtk.js/Rendering/Core/Actor'
import vtkColorTransferFunction from '@kitware/vtk.js/Rendering/Core/ColorTransferFunction'
import vtkScalarBarActor from '@kitware/vtk.js/Rendering/Core/ScalarBarActor'
import vtkPoints from '@kitware/vtk.js/Common/Core/Points'
import vtkDataArray from '@kitware/vtk.js/Common/Core/DataArray'
import vtkCellArray from '@kitware/vtk.js/Common/Core/CellArray'
import vtkPolyData from '@kitware/vtk.js/Common/DataModel/PolyData'

export interface VtkViewport {
  renderer: any
  renderWindow: any
  interactor: any
  grw: any
  resize: () => void
  destroy: () => void
}

export function createVtkViewport(
  container: HTMLElement,
  background: [number, number, number] = [0.06, 0.07, 0.1]
): VtkViewport {
  const grw = vtkGenericRenderWindow.newInstance({ background })
  grw.setContainer(container)
  const renderer = grw.getRenderer()
  const renderWindow = grw.getRenderWindow()
  const interactor = grw.getInteractor()
  interactor.setInteractorStyle(vtkInteractorStyleTrackballCamera.newInstance())
  const resize = (): void => grw.resize()
  resize()
  return {
    renderer,
    renderWindow,
    interactor,
    grw,
    resize,
    destroy: () => {
      try {
        ;(grw as unknown as { setContainer: (c: HTMLElement | null) => void }).setContainer(null)
      } catch {
        // 忽略
      }
    }
  }
}

/** 由 Tecplot 结构化 zone 构建 vtkPolyData（点 + 可选 I-J 表面四边形），点数据里放各变量 */
export interface TecplotGrid {
  xyz: Float32Array
  dims: [number, number, number]
  vars: Record<string, Float32Array>
}

export function buildStructuredPolydata(grid: TecplotGrid, activeVar: string): any {
  const points = vtkPoints.newInstance({ numberOfComponents: 3 })
  ;(points as any).setData(grid.xyz)

  const polydata = vtkPolyData.newInstance()
  ;(polydata as any).setPoints(points)

  const pointData = (polydata as any).getPointData()
  const names = Object.keys(grid.vars)
  names.forEach((name) => {
    pointData.addArray(
      vtkDataArray.newInstance({ name, numberOfComponents: 1, values: grid.vars[name] })
    )
  })
  const first = names.includes(activeVar) ? activeVar : names[0]
  if (first) pointData.setActiveScalars(first)

  const [I, J] = grid.dims
  if (I > 1 && J > 1) {
    const cells = vtkCellArray.newInstance()
    for (let j = 0; j < J - 1; j += 1) {
      for (let i = 0; i < I - 1; i += 1) {
        const a = j * I + i
        const b = a + 1
        const c = (j + 1) * I + i + 1
        const d = (j + 1) * I + i
        cells.insertNextCell([a, b, c, d])
      }
    }
    ;(polydata as any).setPolys(cells)
  }

  return polydata
}

/** 由 STEP 等输出的三角网格（positions xyz 平铺 + indices）构建 vtkPolyData */
export function buildPolydataFromTriangles(positions: number[], indices: number[]): any {
  const points = vtkPoints.newInstance({ numberOfComponents: 3 })
  ;(points as any).setData(Float32Array.from(positions))
  const polydata = vtkPolyData.newInstance()
  ;(polydata as any).setPoints(points)

  const cells = vtkCellArray.newInstance()
  for (let i = 0; i + 2 < indices.length; i += 3) {
    cells.insertNextCell([indices[i], indices[i + 1], indices[i + 2]])
  }
  ;(polydata as any).setPolys(cells)
  return polydata
}

export function makeColorTransfer(): any {
  const ctf = vtkColorTransferFunction.newInstance()
  ctf.addRGBPoint(0, 0.23, 0.3, 0.75)
  ctf.addRGBPoint(0.5, 0.87, 0.87, 0.87)
  ctf.addRGBPoint(1, 0.83, 0.14, 0.14)
  return ctf
}

export function makeFieldActor(dataset: any, ctf: any): { mapper: any; actor: any; range: number[] } {
  const mapper = vtkMapper.newInstance()
  mapper.setInputData(dataset)
  mapper.setScalarModeToUsePointData()
  mapper.setColorModeToMapScalars()
  mapper.setLookupTable(ctf)
  const r = dataset.getPointData().getScalars()?.getRange?.() ?? [0, 1]
  mapper.setScalarRange(r[0], r[1])
  const actor = vtkActor.newInstance()
  actor.setMapper(mapper)
  return { mapper, actor, range: r }
}

export function makeGeometryActor(
  dataset: any
): { mapper: any; actor: any } {
  const mapper = vtkMapper.newInstance()
  mapper.setInputData(dataset)
  const actor = vtkActor.newInstance()
  actor.setMapper(mapper)
  return { mapper, actor }
}

export function setRepresentation(actor: any, representation: 'surface' | 'wireframe' | 'points'): void {
  const p = actor.getProperty()
  if (representation === 'wireframe') {
    p.setRepresentationToWireframe()
  } else if (representation === 'points') {
    p.setRepresentationToPoints()
    p.setPointSize(3)
  } else {
    p.setRepresentationToSurface()
  }
}

export function makeScalarBar(ctf: any): any {
  const sb = vtkScalarBarActor.newInstance()
  ;(sb as any).setLookupTable(ctf)
  return sb
}

export function render(viewport: VtkViewport): void {
  viewport.renderer.resetCamera()
  viewport.renderWindow.render()
}

export function b64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64)
  const len = bin.length
  const bytes = new Uint8Array(len)
  for (let i = 0; i < len; i += 1) bytes[i] = bin.charCodeAt(i)
  return bytes.buffer
}

export function b64ToText(b64: string): string {
  return new TextDecoder().decode(b64ToArrayBuffer(b64))
}
