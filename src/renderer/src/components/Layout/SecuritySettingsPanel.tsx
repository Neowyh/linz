import { useEffect, useMemo, useState } from 'react'
import { Select, Tag, Button, message, Empty, Spin, Popconfirm, Alert, Input } from 'antd'
import { DeleteOutlined, ClearOutlined, SafetyCertificateOutlined, LockOutlined, FolderOpenOutlined } from '@ant-design/icons'

type PolicyAction = 'allow' | 'ask' | 'deny'

const RISK_META: Record<string, { label: string; color: string }> = {
  read: { label: '只读', color: 'default' },
  write: { label: '写入', color: 'orange' },
  execute: { label: '执行', color: 'red' },
  delegate: { label: '委派', color: 'purple' },
  network: { label: '网络', color: 'cyan' }
}

const POLICY_LABEL: Record<string, string> = { allow: '允许', ask: '询问', deny: '禁止' }

interface AuditRow {
  id: number
  ts: number
  agent_type: string | null
  tool_name: string
  args_summary: string
  risk: string
  decision: string
  source: string
  duration_ms: number
}

interface Remembered {
  fingerprint: string
  toolName: string
  argsSummary: string
  ts: number
}

const DECISION_COLOR: Record<string, string> = {
  allow: 'green',
  remembered: 'blue',
  approve: 'green',
  deny: 'red',
  timeout: 'orange'
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleString('zh-CN', { hour12: false })
}

export default function SecuritySettingsPanel(): JSX.Element {
  const [risks, setRisks] = useState<Record<string, string>>({})
  const [policies, setPolicies] = useState<Record<string, PolicyAction>>({})
  const [remembered, setRemembered] = useState<Remembered[]>([])
  const [audit, setAudit] = useState<AuditRow[]>([])
  const [loading, setLoading] = useState(false)
  const [auditLoading, setAuditLoading] = useState(false)
  const [protectedPaths, setProtectedPaths] = useState<string[]>([])
  const [pathInput, setPathInput] = useState('')

  const loadAll = async (): Promise<void> => {
    setLoading(true)
    try {
      const [r, p, mem, prot] = await Promise.all([
        window.aeromind.security.listRisks(),
        window.aeromind.security.listPolicies(),
        window.aeromind.security.listRemembered(),
        window.aeromind.security.listProtected()
      ])
      setRisks(r || {})
      setPolicies(p || {})
      setRemembered(mem || [])
      setProtectedPaths(prot || [])
    } finally {
      setLoading(false)
    }
  }

  const loadAudit = async (): Promise<void> => {
    setAuditLoading(true)
    try {
      const rows = await window.aeromind.security.listAudit(50)
      setAudit(rows || [])
    } finally {
      setAuditLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
    loadAudit()
  }, [])

  const grouped = useMemo(() => {
    const order = ['read', 'write', 'execute', 'delegate', 'network']
    const groups: Record<string, string[]> = {}
    for (const tool of Object.keys(risks)) {
      const risk = risks[tool] || 'network'
      if (!groups[risk]) groups[risk] = []
      groups[risk].push(tool)
    }
    return order.filter((r) => groups[r]).map((risk) => ({ risk, tools: groups[risk] }))
  }, [risks])

  const setPolicy = async (tool: string, value: PolicyAction | 'default'): Promise<void> => {
    const action = value === 'default' ? null : value
    const res = await window.aeromind.security.setPolicy(tool, action)
    if (res.success) {
      setPolicies((prev) => {
        const next = { ...prev }
        if (action === null) delete next[tool]
        else next[tool] = action
        return next
      })
      message.success(`已更新「${tool}」策略`)
    } else {
      message.error(res.error || '更新失败')
    }
  }

  const forget = async (fingerprint: string): Promise<void> => {
    const res = await window.aeromind.security.forgetRemembered(fingerprint)
    if (res.success) {
      setRemembered((prev) => prev.filter((r) => r.fingerprint !== fingerprint))
      message.success('已撤销该批准记忆')
    } else {
      message.error(res.error || '撤销失败')
    }
  }

  const clearAudit = async (): Promise<void> => {
    const res = await window.aeromind.security.clearAudit()
    if (res.success) {
      setAudit([])
      message.success('已清空审计日志')
    } else {
      message.error('清空失败')
    }
  }

  const addProtected = async (p: string): Promise<void> => {
    const res = await window.aeromind.security.addProtected(p)
    if (res.success) {
      setProtectedPaths(await window.aeromind.security.listProtected())
      setPathInput('')
      message.success('已加入文件防护')
    } else {
      message.error(res.error || '添加失败')
    }
  }

  const pickProtectedDir = async (): Promise<void> => {
    const dir = await window.aeromind.security.pickProtectedDirectory()
    if (dir) await addProtected(dir)
  }

  const removeProtected = async (p: string): Promise<void> => {
    await window.aeromind.security.removeProtected(p)
    setProtectedPaths(await window.aeromind.security.listProtected())
    message.success('已移除防护')
  }

  return (
    <div className="space-y-4">
      <Alert
        type="info"
        showIcon
        message="Agent 执行写入、执行脚本、委派、网络等操作前会弹出确认卡；只读操作默认直接执行。你可以在下方为每个工具单独设置 允许/询问/禁止。"
      />

      {/* 文件防护：受保护路径 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <LockOutlined className="text-red-500" />
          <h4 className="text-sm font-medium text-gray-900">文件防护（受保护路径）</h4>
        </div>
        <Alert
          type="warning"
          showIcon
          message="以下文件/目录对所有 Agent 工具不可见。任何工具调用（读文件/写文件/执行脚本等）命中这些路径都会被拦截，并在对话框中提示。注意：保护父目录会一并拦截其下所有内容。"
          style={{ marginBottom: 8 }}
        />
        <div className="flex items-center gap-2 mb-2">
          <Input
            size="small"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            onPressEnter={() => { if (pathInput.trim()) addProtected(pathInput.trim()) }}
            placeholder="输入要保护的路径，如 C:\Users\me\Documents\机密"
          />
          <Button size="small" type="primary" onClick={() => { if (pathInput.trim()) addProtected(pathInput.trim()) }}>添加</Button>
          <Button size="small" icon={<FolderOpenOutlined />} onClick={pickProtectedDir}>选择文件夹</Button>
        </div>
        {protectedPaths.length === 0 ? (
          <div className="text-xs text-gray-400">尚未添加受保护路径</div>
        ) : (
          <div className="space-y-1.5 max-h-40 overflow-y-auto">
            {protectedPaths.map((p) => (
              <div key={p} className="flex items-center justify-between bg-red-50/50 rounded-md px-2 py-1.5">
                <span className="font-mono text-xs text-gray-700 truncate" title={p}>{p}</span>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => removeProtected(p)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 按工具策略 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <SafetyCertificateOutlined className="text-primary" />
          <h4 className="text-sm font-medium text-gray-900">工具权限策略</h4>
        </div>
        {loading ? (
          <Spin size="small" />
        ) : grouped.length === 0 ? (
          <div className="text-xs text-gray-400">暂无工具数据</div>
        ) : (
          <div className="space-y-3">
            {grouped.map((g) => {
              const meta = RISK_META[g.risk] || RISK_META.network
              return (
                <div key={g.risk}>
                  <div className="flex items-center gap-2 mb-1">
                    <Tag color={meta.color} style={{ fontSize: '10px', margin: 0 }}>{meta.label}</Tag>
                    <span className="text-[11px] text-gray-400">默认：{POLICY_LABEL[g.risk === 'read' ? 'allow' : 'ask']}</span>
                  </div>
                  <div className="space-y-1.5 pl-1">
                    {g.tools.map((tool) => (
                      <div key={tool} className="flex items-center justify-between bg-gray-50 rounded-md px-2 py-1.5">
                        <span className="font-mono text-xs text-gray-700">{tool}</span>
                        <Select
                          size="small"
                          style={{ width: 100 }}
                          value={policies[tool] || 'default'}
                          onChange={(v) => setPolicy(tool, v)}
                          options={[
                            { value: 'default', label: '默认' },
                            { value: 'allow', label: '允许' },
                            { value: 'ask', label: '询问' },
                            { value: 'deny', label: '禁止' }
                          ]}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* 已记住的批准 */}
      <div>
        <div className="flex items-center gap-2 mb-2">
          <SafetyCertificateOutlined className="text-primary" />
          <h4 className="text-sm font-medium text-gray-900">已记住的批准（始终允许）</h4>
        </div>
        {remembered.length === 0 ? (
          <Empty description="暂无" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="space-y-1.5 max-h-48 overflow-y-auto">
            {remembered.map((r) => (
              <div key={r.fingerprint} className="flex items-center justify-between bg-gray-50 rounded-md px-2 py-1.5">
                <div className="min-w-0 pr-2">
                  <div className="font-mono text-xs text-gray-700 truncate">{r.toolName} <span className="text-gray-400 text-[10px]">{fmtTime(r.ts)}</span></div>
                  <div className="text-[10px] text-gray-400 font-mono truncate">{r.argsSummary}</div>
                </div>
                <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={() => forget(r.fingerprint)} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 审计日志 */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <SafetyCertificateOutlined className="text-primary" />
            <h4 className="text-sm font-medium text-gray-900">安全审计日志</h4>
          </div>
          <div className="flex items-center gap-2">
            <Button size="small" onClick={loadAudit}>刷新</Button>
            <Popconfirm title="确定清空全部审计日志？" onConfirm={clearAudit} okText="清空" cancelText="取消">
              <Button size="small" danger icon={<ClearOutlined />}>清空</Button>
            </Popconfirm>
          </div>
        </div>
        {auditLoading ? (
          <Spin size="small" />
        ) : audit.length === 0 ? (
          <Empty description="暂无记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        ) : (
          <div className="border border-gray-200 rounded-md max-h-64 overflow-y-auto divide-y divide-gray-100">
            {audit.map((row) => (
              <div key={row.id} className="px-2 py-1.5 text-[11px]">
                <div className="flex items-center gap-2">
                  <span className="text-gray-400 whitespace-nowrap">{fmtTime(row.ts)}</span>
                  <Tag color={DECISION_COLOR[row.decision] || 'default'} style={{ fontSize: '9px', padding: '0 5px', margin: 0 }}>
                    {row.decision}
                  </Tag>
                  <span className="font-mono font-medium text-gray-700">{row.tool_name}</span>
                  {row.agent_type && <span className="text-gray-400">· {row.agent_type}</span>}
                  <span className="ml-auto text-gray-300 whitespace-nowrap">{row.duration_ms}ms</span>
                </div>
                <div className="text-gray-400 font-mono truncate mt-0.5">{row.args_summary}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
