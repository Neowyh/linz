// vtk.js 深路径子模块中缺少 .d.ts 的，在此补充为 any，避免 TS7016
declare module '@kitware/vtk.js/Interaction/Style/InteractorStyleTrackballCamera' {
  const v: any
  export default v
}
