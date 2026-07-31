import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import { z } from 'zod'
import * as tables from '../../database/tables'

// 表格数据库查表工具：模型先调 db_tables 发现表结构，再用 db_query 发只读 SELECT 精确查表
// 数据来自文档库"数据库"Tab 导入的 xlsx/csv 等文件（每工作区 tables.db）

function formatTableSchema(): string {
  const datasets = tables.listDatasets()
  if (datasets.length === 0) {
    return '表格数据库为空。请先在「文档库 → 数据库」页导入 xlsx/csv/tsv/txt 文件。'
  }
  const allTables = tables.listAllTables()
  const lines: string[] = [`共 ${datasets.length} 个数据集：`]
  for (const ds of datasets) {
    lines.push(`\n数据集「${ds.name}」（来源 ${ds.source_file}，共 ${ds.total_rows} 行）：`)
    for (const t of allTables.filter((x) => x.dataset_id === ds.id)) {
      const cols = t.columns.map((c) => `"${c.name}" ${c.type}`).join(', ')
      lines.push(`  表 "${t.table_name}"（${t.row_count} 行）: ${cols}`)
    }
  }
  lines.push('\n查询时表名和列名用双引号包裹，例如：SELECT "Cd" FROM "表名" WHERE "马赫数" = 0.8')
  return lines.join('\n')
}

export const dbTablesTool = new DynamicStructuredTool({
  name: 'db_tables',
  description:
    '列出表格数据库中所有已导入的数据表及其结构（表名、列名、类型、行数）。需要查表获取精确数据时，先调用本工具了解有哪些表和列，再用 db_query 查询。',
  schema: z.object({}),
  func: async (): Promise<string> => {
    try {
      return formatTableSchema()
    } catch (err: any) {
      return `获取表结构失败: ${err.message || String(err)}`
    }
  }
}) as unknown as Tool

export const dbQueryTool = new DynamicStructuredTool({
  name: 'db_query',
  description:
    '对表格数据库执行只读 SQL 查询（仅 SELECT），返回精确匹配的数据行。适用于查找材料属性、气动系数等结构化数据。表名和列名用双引号包裹。不清楚有哪些表时先调用 db_tables。',
  schema: z.object({
    sql: z
      .string()
      .describe('单条 SELECT 语句，例如 SELECT * FROM "翼型气动数据" WHERE "马赫数" = 0.8 或 SELECT AVG("Cd") FROM "翼型气动数据"')
  }),
  func: async ({ sql }: { sql: string }): Promise<string> => {
    try {
      const result = tables.runReadOnlyQuery(sql)
      if (result.rows.length === 0) {
        return '查询成功，但没有匹配的数据行。'
      }
      const header = '| ' + result.columns.join(' | ') + ' |'
      const separator = '| ' + result.columns.map(() => '---').join(' | ') + ' |'
      const body = result.rows.map(
        (row) => '| ' + result.columns.map((c) => String(row[c] ?? 'NULL')).join(' | ') + ' |'
      )
      const parts = [header, separator, ...body]
      if (result.truncated) {
        parts.push(`\n(结果过多，仅显示前 ${result.rows.length} 行，请加 LIMIT 或更精确的 WHERE 条件缩小范围)`)
      }
      return parts.join('\n')
    } catch (err: any) {
      return `查询失败: ${err.message || String(err)}`
    }
  }
}) as unknown as Tool
