import { memo, useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

type Rep = 'surface' | 'wireframe' | 'points'

// 显式释放几何体与材质的 GPU 缓冲区。
// Three.js 不会随 scene.remove 自动回收 GPU 内存，同上下文内反复重建会累积泄漏。
function disposeObject3D(obj: THREE.Object3D): void {
  const geo = (obj as THREE.Mesh).geometry as THREE.BufferGeometry | undefined
  if (geo) geo.dispose()
  const mat = (obj as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined
  if (mat) {
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose())
    else mat.dispose()
  }
}

interface Props {
  positions: number[]
  indices: number[]
  representation: Rep
  /** WebGL 上下文创建失败时回调（父级可切到软件渲染回退） */
  onFail?: () => void
}

/**
 * Three.js(WebGL)渲染的 3D 网格查看器。
 * 数据来源统一为 {positions, indices}(STEP 由主进程 occt-import-js 转网格，STL/OBJ 由读取器抽取)。
 */
export default memo(function ThreeMeshViewer({ positions, indices, representation, onFail }: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const objectsRef = useRef<THREE.Object3D[]>([])
  const onFailRef = useRef(onFail)
  onFailRef.current = onFail
  const repRef = useRef<Rep>(representation)
  repRef.current = representation

  // 创建渲染器/场景/相机/控制器（一次）
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false })
    } catch (e) {
      onFailRef.current?.()
      return
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
    renderer.setSize(wrap.clientWidth, wrap.clientHeight)
    wrap.appendChild(renderer.domElement)
    renderer.domElement.style.width = '100%'
    renderer.domElement.style.height = '100%'
    renderer.domElement.style.display = 'block'
    rendererRef.current = renderer

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x171a22)
    sceneRef.current = scene
    scene.add(new THREE.AmbientLight(0xffffff, 0.6))
    const dir = new THREE.DirectionalLight(0xffffff, 0.9)
    dir.position.set(1, 1, 1)
    scene.add(dir)

    const camera = new THREE.PerspectiveCamera(50, wrap.clientWidth / Math.max(1, wrap.clientHeight), 0.01, 1e6)
    cameraRef.current = camera

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.1
    controlsRef.current = controls

    const ro = new ResizeObserver(() => {
      const w = wrap.clientWidth
      const h = wrap.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    })
    ro.observe(wrap)

    // RAF 循环受可见性门控：面板被 dock 隐藏（display:none / 0×0）时停止渲染，
    // 避免空转渲染隐藏画布持续吃 GPU、拖慢整机。可见时恢复。
    // 注：damping 需要持续 update 才有惯性，但隐藏时无人交互，停掉无副作用。
    let raf = 0
    let visible = false
    const loop = (): void => {
      if (!visible) return // 不可见时不再排帧（恢复时由 observer 重新 kick）
      controls.update()
      renderer.render(scene, camera)
      raf = requestAnimationFrame(loop)
    }
    const kick = (): void => {
      if (raf) return
      raf = requestAnimationFrame(loop)
    }
    const stop = (): void => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }

    // IntersectionObserver：wrap 与视口无交集（含 display:none / 被移出可视区 / 0 尺寸）即不可见
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        const next = entry.isIntersecting && entry.intersectionRatio > 0
        if (next === visible) return
        visible = next
        if (visible) kick()
        else stop()
      },
      { threshold: [0, 0.0001] }
    )
    io.observe(wrap)

    // 首帧：若初始即可见（典型情况），启动循环
    if (wrap.clientWidth > 0 && wrap.clientHeight > 0) {
      visible = true
      kick()
    }

    return () => {
      stop()
      io.disconnect()
      ro.disconnect()
      controls.dispose()
      objectsRef.current.forEach((o) => {
      disposeObject3D(o)
      scene.remove(o)
    })
      objectsRef.current = []
      renderer.dispose()
      if (renderer.domElement.parentNode) renderer.domElement.parentNode.removeChild(renderer.domElement)
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      controlsRef.current = null
    }
  }, [])

  // 数据/表示变化时重建几何并取景
  useEffect(() => {
    const scene = sceneRef.current
    const renderer = rendererRef.current
    if (!scene || !renderer) return
    objectsRef.current.forEach((o) => {
      disposeObject3D(o)
      scene.remove(o)
    })
    objectsRef.current = []
    if (positions.length < 9 || indices.length < 3) return

    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3))
    geo.setIndex(indices)
    geo.computeVertexNormals()
    geo.computeBoundingSphere()

    const rep = repRef.current
    let obj: THREE.Object3D
    if (rep === 'points') {
      obj = new THREE.Points(
        geo,
        new THREE.PointsMaterial({ color: 0x9cc6ff, size: 3, sizeAttenuation: false })
      )
    } else {
      const mat = new THREE.MeshStandardMaterial({
        color: 0x8fb6e0,
        wireframe: rep === 'wireframe',
        side: THREE.DoubleSide,
        flatShading: true,
        roughness: 0.7,
        metalness: 0.1
      })
      obj = new THREE.Mesh(geo, mat)
    }
    scene.add(obj)
    objectsRef.current = [obj]

    const camera = cameraRef.current
    const s = geo.boundingSphere
    if (camera && s) {
      camera.near = Math.max(0.01, s.radius * 0.01)
      camera.far = Math.max(100, s.radius * 1000)
      camera.updateProjectionMatrix()
      camera.position.set(s.center.x, s.center.y, s.center.z + s.radius * 2.6)
      camera.lookAt(s.center)
      if (controlsRef.current) {
        controlsRef.current.target.copy(s.center)
        controlsRef.current.update()
      }
    }
  }, [positions, indices, representation])

  return (
    <div ref={wrapRef} className="w-full h-full overflow-hidden" style={{ background: '#171a22' }} />
  )
})