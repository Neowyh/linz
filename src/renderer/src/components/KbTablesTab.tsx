import { useState, useEffect, useCallback } from 'react'
import { Button, Empty, message, Popconfirm, Collapse, Table, Tag, Input } from 'antd'
import { DeleteOutlined, ImportOutlined, ReloadOutlined, PlayCircleOutlined } from '@ant-design/icons'

interface TableColumnMeta {
  name: string
  type: string
}

interface TableMeta {
  id: string
  table_name: string
  sheet_name: string | null
  columns: TableColumnMeta[]
  row_count: number
}

interface TableDataset {
  id: string
  name: string
  source_file: string
  file_type: string
  table_count: number
  total_rows: number
  created_at: string
  tables: TableMeta[]
}

interface PreviewData {
  columns: string[]
  rows: Array<Record<string, unknown>>
  truncated: boolean
}

interface QueryPayload extends PreviewData {
  success: boolean
  error?: string
}

function ResultTable({ data, tableKey }: { data: PreviewData; tableKey: string }): JSX.Element {
  return (
    <Table<Record<string, unknown>>
      size="small"
      scroll={{ x: true }}
      pagination={false}
      rowKey={(_row, idx) => `${tableKey}-${idx ?? 0}`}
      columns={data.columns.map((c) => ({
        title: c,
        dataIndex: c,
        key: c,
        render: (v: unknown) =>
          v === null || v === undefined ? <span className="text-gray-300">NULL</span> : String(v)
      }))}
      dataSource={data.rows}
    />
  )
}

export default function KbTablesTab(): JSX.Element {
  const [datasets, setDatasets] = useState<TableDataset[]>([])
  const [importing, setImporting] = useState(false)
  const [previews, setPreviews] = useState<Record<string, PreviewData>>({})
  const [previewLoading, setPreviewLoading] = useState<string | null>(null)
  const [sql, setSql] = useState('')
  const [queryResult, setQueryResult] = useState<QueryPayload | null>(null)
  const [querying, setQuerying] = useState(false)

  const load = useCallback(async (): Promise<void> => {
    try {
      setDatasets(await window.aeromind.tables.list())
    } catch {
      message.error('加载表格数据失败')
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const handleImport = async (): Promise<void> => {
    setImporting(true)
    try {
      const results = await window.aeromind.tables.import()
      for (const r of results) {
        if (r.status === 'done') {
          message.success(`${r.fileName}：导入 ${r.tableCount} 张表，共 ${r.totalRows} 行`)
        } else {
          message.error(`${r.fileName}：${r.error}`)
        }
      }
      if (results.length > 0) load()
    } catch (err: any) {
      message.error('导入失败: ' + (err.message || '未知错误'))
    } finally {
      setImporting(false)
    }
  }

  const handlePreview = async (tableName: string): Promise<void> => {
    setPreviewLoading(tableName)
    try {
      const res = await window.aeromind.tables.preview(tableName, 20)
      if (res.success) {
        setPreviews((p) => ({ ...p, [tableName]: res }))
      } else {
        message.error(res.error || '预览失败')
      }
    } finally {
      setPreviewLoading(null)
    }
  }

  const handleDelete = async (datasetId: string): Promise<void> => {
    const res = await window.aeromind.tables.remove(datasetId)
    if (res.success) {
      message.success('数据集已删除')
      load()
    } else {
      message.error(res.error || '删除失败')
    }
  }

  const handleQuery = async (): Promise<void> => {
    if (!sql.trim()) return
    setQuerying(true)
    try {
      setQueryResult(await window.aeromind.tables.query(sql))
    } catch (err: any) {
      message.error('查询失败: ' + (err.message || '未知错误'))
    } finally {
      setQuerying(false)
    }
  }

  return (
    <div>
      {/* 标题栏 */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">表格数据库</h2>
          <p className="text-xs text-gray-600 mt-1">
            已导入 {datasets.length} 个数据集。表格文件会解析为真实数据表，Agent 可通过 db_tables / db_query 工具精确查表。
          </p>
        </div>
        <div className="flex gap-2">
          <Button icon={<ReloadOutlined />} onClick={load}>
            刷新
          </Button>
          <Button type="primary" icon={<ImportOutlined />} loading={importing} onClick={handleImport}>
            导入表格文件
          </Button>
        </div>
      </div>

      {/* 数据集列表 */}
      {datasets.length === 0 ? (
        <Empty description='暂无数据集，点击"导入表格文件"开始（支持 .xlsx/.xls/.csv/.tsv/.txt）' />
      ) : (
        <Collapse
          className="mb-8"
          items={datasets.map((ds) => ({
            key: ds.id,
            label: (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium">{ds.name}</span>
                <Tag>{ds.file_type}</Tag>
                <span className="text-xs text-gray-400">
                  {ds.table_count} 张表 · {ds.total_rows} 行 · {ds.created_at}
                </span>
              </div>
            ),
            extra: (
              <Popconfirm
                title={`确定删除数据集「${ds.name}」？`}
                description="其下所有数据表将一并删除，不可恢复"
                onConfirm={(e) => {
                  e?.stopPropagation()
                  handleDelete(ds.id)
                }}
                onCancel={(e) => e?.stopPropagation()}
                okText="删除"
                cancelText="取消"
                okButtonProps={{ danger: true }}
              >
                <Button
                  type="text"
                  size="small"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={(e) => e.stopPropagation()}
                />
              </Popconfirm>
            ),
            children: (
              <div className="space-y-4">
                <div className="text-xs text-gray-400 truncate" title={ds.source_file}>
                  来源：{ds.source_file}
                </div>
                {ds.tables.map((t) => (
                  <div key={t.id} className="border border-gray-100 rounded-card p-3">
                    <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Tag color="blue">{t.table_name}</Tag>
                        {t.sheet_name && <span className="text-xs text-gray-400">sheet: {t.sheet_name}</span>}
                        <span className="text-xs text-gray-400">{t.row_count} 行</span>
                      </div>
                      <Button
                        size="small"
                        loading={previewLoading === t.table_name}
                        onClick={() => handlePreview(t.table_name)}
                      >
                        {previews[t.table_name] ? '刷新预览' : '预览前 20 行'}
                      </Button>
                    </div>
                    <div className="flex gap-1 flex-wrap mb-2">
                      {t.columns.map((c) => (
                        <Tag key={c.name} className="text-xs">
                          {c.name} <span className="text-gray-400">{c.type}</span>
                        </Tag>
                      ))}
                    </div>
                    {previews[t.table_name] && (
                      <ResultTable data={previews[t.table_name]} tableKey={t.id} />
                    )}
                  </div>
                ))}
              </div>
            )
          }))}
        />
      )}

      {/* SQL 试查 */}
      <div className="bg-white rounded-card border border-gray-100 p-4 shadow-sm">
        <h3 className="text-sm font-medium text-gray-900 mb-3">🔍 SQL 试查（只读 SELECT，与 Agent 的 db_query 工具同一入口）</h3>
        <div className="flex gap-2">
          <Input
            value={sql}
            onChange={(e) => setSql(e.target.value)}
            onPressEnter={handleQuery}
            placeholder='例如 SELECT * FROM "翼型气动数据" WHERE "马赫数" = 0.8'
            className="flex-1"
          />
          <Button type="primary" icon={<PlayCircleOutlined />} onClick={handleQuery} loading={querying}>
            查询
          </Button>
        </div>
        {queryResult && (
          <div className="mt-4">
            {queryResult.success ? (
              <>
                <ResultTable data={queryResult} tableKey="query" />
                {queryResult.truncated && (
                  <p className="text-xs text-gray-400 mt-2">结果过多，仅显示前 200 行</p>
                )}
                {queryResult.rows.length === 0 && (
                  <p className="text-xs text-gray-400">查询成功，但没有匹配的数据行</p>
                )}
              </>
            ) : (
              <p className="text-xs text-red-500">{queryResult.error}</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
