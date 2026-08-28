// 知识图谱后端冒烟测试：内存 kb.db + 假文档 → buildGraph / enrich 解析
import './graph-smoke-polyfill'
process.env.NODE_ENV = 'test'

import path from 'path'
import os from 'os'
import fs from 'fs'
import { initKbDatabase, insertDocument, insertChunks, finalizeDocument, listGraphDocuments, getDocumentTermVectors, closeKbDatabase } from '../src/main/database/kb'
import { buildGraph } from '../src/main/graph/graph-builder'

const tmpDb = path.join(os.tmpdir(), `kb-graph-test-${Date.now()}.db`)
initKbDatabase(tmpDb)

function addDoc(id: string, name: string, category: string, tags: string[], chunks: string[]): void {
  insertDocument({ id, filePath: `/fake/${name}`, fileName: name, fileType: 'txt', fileSize: 100, tags })
  insertChunks(id, chunks)
  finalizeDocument(id, category, chunks.length)
}

addDoc('d1', 'NACA0012翼型气动分析.txt', '气动分析', ['翼型', 'CFD'], [
  'NACA0012 翼型在迎角 5 度时的升力系数与阻力系数计算，采用雷诺数 3e6 的湍流边界层分析',
  '压力分布显示前缘吸力峰明显，升阻比随迎角变化'
])
addDoc('d2', '机翼结构设计报告.txt', '结构强度', ['机翼'], [
  '机翼蒙皮与翼梁的有限元应力分析，铝合金材料屈曲校核',
  '翼肋间距对结构强度的影响，载荷传递路径'
])
addDoc('d3', '翼型升阻特性综述.txt', '气动分析', ['翼型'], [
  '翼型升力系数随迎角线性增长直至失速，阻力系数与雷诺数相关',
  '层流翼型的边界层转捩控制可降低摩擦阻力'
])
addDoc('d4', '涡扇发动机选型.txt', '推进设计', [], [
  '涡扇发动机涵道比与耗油率的权衡，推力需求计算',
  '压气机与涡轮匹配，燃烧室温度限制'
])

const docs = listGraphDocuments()
console.log(`docs: ${docs.length}`)
const vecs = getDocumentTermVectors()
console.log(`term vectors: ${vecs.length}, sample terms d1: ${vecs[0] ? Array.from(vecs[0].terms.keys()).slice(0, 8).join(',') : 'N/A'}`)

const g1 = buildGraph({ includeEntities: false })
console.log(`graph(全量): nodes=${g1.nodes.length} edges=${g1.edges.length}`)
for (const e of g1.edges) console.log(`  ${e.kind} ${e.source} <-> ${e.target} w=${e.weight}`)

// 前端阈值过滤模拟：weight >= 0.5 的边
const highEdges = g1.edges.filter((e) => (e.weight ?? 0) >= 0.5)
console.log(`前端过滤 weight>=0.5: ${highEdges.length} 条边`)

// 缓存命中验证：第二次调用应走缓存（结果一致即为命中）
const g3 = buildGraph({ includeEntities: false })
console.log(`cache consistent: ${g1.edges.length === g3.edges.length}`)

closeKbDatabase()
fs.rmSync(tmpDb, { force: true })
fs.rmSync(`${tmpDb}-wal`, { force: true })
fs.rmSync(`${tmpDb}-shm`, { force: true })
console.log('SMOKE OK')
