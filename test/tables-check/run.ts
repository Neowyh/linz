// 真实代码路径冒烟测试：import → tables.db → runReadOnlyQuery → 工具包装
// 运行: npx esbuild test/tables-check/run.ts --bundle --platform=node --format=cjs --external:better-sqlite3 --outfile=test/tables-check/bundle.cjs && node test/tables-check/bundle.cjs
import fs from 'fs'
import os from 'os'
import path from 'path'
import XLSX from 'xlsx'
import {
  initTablesDatabase,
  closeTablesDatabase,
  listDatasets,
  listAllTables,
  runReadOnlyQuery,
  previewRows
} from '../../src/main/database/tables'
import { importTableFile } from '../../src/main/tables/import'

// 说明：db-query.tool.ts 依赖 @langchain/core（需要 Node 18+ 的 ReadableStream），
// 无法在 Electron 22 的 Node 16 下直接加载，故工具包装层不在此冒烟。
// 工具的查询核心即 runReadOnlyQuery，已在下面覆盖。

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tables-check-'))

let failed = 0
function check(name: string, cond: boolean, detail?: unknown): void {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${cond ? '' : '  ' + JSON.stringify(detail)}`)
  if (!cond) failed++
}

async function main(): Promise<void> {
initTablesDatabase(path.join(dir, 'tables.db'))

// 1. CSV（中文列名 + 数字类型推断）
const csvPath = path.join(dir, '翼型数据.csv')
fs.writeFileSync(csvPath, '马赫数,迎角,Cl,Cd\n0.5,2,0.31,0.011\n0.8,2,0.42,0.019\n0.8,4,0.55,0.028\n')
const r1 = importTableFile(csvPath)
check('csv import done', r1.status === 'done' && r1.totalRows === 3, r1)

// 2. xlsx 多 sheet
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['材料', '密度', '弹性模量'], ['铝合金2024', 2780, 73.1], ['钛合金TC4', 4440, 110]]), '金属材料')
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['牌号', '用途'], ['2024-T3', '蒙皮']]), '备注')
const xlsxPath = path.join(dir, '材料库.xlsx')
XLSX.writeFile(wb, xlsxPath)
const r2 = importTableFile(xlsxPath)
check('xlsx import done (2 sheets)', r2.status === 'done' && r2.tableCount === 2, r2)

// 3. 数据集与表结构
check('dataset count = 2', listDatasets().length === 2)
const mats = listAllTables().find((t) => t.table_name.includes('金属材料'))
check('sheet table columns typed', !!mats && mats.columns.find((c) => c.name === '密度')?.type === 'INTEGER', mats?.columns)

// 4. 精确查询
const q1 = runReadOnlyQuery('SELECT "Cd" FROM "翼型数据" WHERE "马赫数" = 0.8 AND "迎角" = 2')
check('exact query', q1.rows.length === 1 && q1.rows[0]['Cd'] === 0.019, q1)
const q2 = runReadOnlyQuery('SELECT AVG("Cd") AS avg_cd FROM "翼型数据"')
check('aggregate query', q2.rows.length === 1, q2)

// 5. 写入拒绝
try {
  runReadOnlyQuery('DELETE FROM "翼型数据"')
  check('DELETE rejected', false)
} catch (e: any) {
  check('DELETE rejected', /只读/.test(e.message), e.message)
}

// 6. 同名替换
importTableFile(csvPath)
check('reimport replaces (still 2 datasets)', listDatasets().length === 2)

// 7. preview
const pv = previewRows('翼型数据', 2)
check('preview limit', pv.rows.length === 2, pv)

// 8. 工具包装层：查询核心 runReadOnlyQuery 已覆盖（见上方注释）
closeTablesDatabase()
console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECKS FAILED`)
process.exit(failed === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('TEST CRASHED:', err)
  process.exit(1)
})
