import { useState, useEffect } from 'react'
import { Modal, Input, Select, Button, Switch, Form, Space, message, Alert } from 'antd'
import { FolderOpenOutlined, ExperimentOutlined, ThunderboltOutlined } from '@ant-design/icons'
import { useMcpStore } from '../stores/mcpStore'
import type { McpServer, McpTemplate, McpTransport, McpServerFormValues, McpTestResult } from '../types/mcp'

interface Props {
  open: boolean
  initial?: McpServer | null
  template?: McpTemplate | null
  onClose: () => void
  onSaved: () => void
}

interface EnvEntry {
  key: string
  value: string
}

export default function McpServerFormModal({ open, initial, template, onClose, onSaved }: Props): JSX.Element {
  const { createServer, updateServer, testConnection, testing } = useMcpStore()
  const [form, setForm] = useState<McpServerFormValues>(defaultForm())
  const [envEntries, setEnvEntries] = useState<EnvEntry[]>([])
  const [argsText, setArgsText] = useState('')
  const [testResult, setTestResult] = useState<McpTestResult | null>(null)
  const [detecting, setDetecting] = useState(false)

  useEffect(() => {
    if (!open) return
    setTestResult(null)
    if (initial) {
      // 编辑模式
      setForm({
        id: initial.id,
        name: initial.name,
        description: initial.description || '',
        icon: initial.icon || '🔌',
        transport: initial.transport,
        command: initial.command || '',
        args: initial.args || [],
        cwd: initial.cwd || '',
        env: initial.env || {},
        url: initial.url || '',
        enabled: initial.enabled,
        auto_start: initial.auto_start
      })
      setArgsText((initial.args || []).join('\n'))
      setEnvEntries(Object.entries(initial.env || {}).map(([key, value]) => ({ key, value })))
    } else if (template) {
      // 模板新建模式
      setForm({
        name: template.name,
        description: template.description,
        icon: template.icon,
        transport: template.transport,
        command: template.command || '',
        args: template.args || [],
        cwd: template.cwd || '',
        env: template.env || {},
        url: template.url || '',
        enabled: true,
        auto_start: true
      })
      setArgsText((template.args || []).join('\n'))
      setEnvEntries(Object.entries(template.env || {}).map(([key, value]) => ({ key, value })))
    } else {
      // 空白新建
      setForm(defaultForm())
      setArgsText('')
      setEnvEntries([])
    }
  }, [open, initial, template])

  function defaultForm(): McpServerFormValues {
    return {
      name: '',
      description: '',
      icon: '🔌',
      transport: 'stdio',
      command: '',
      args: [],
      cwd: '',
      env: {},
      url: '',
      enabled: true,
      auto_start: true
    }
  }

  function update<K extends keyof McpServerFormValues>(key: K, value: McpServerFormValues[K]): void {
    setForm((prev) => ({ ...prev, [key]: value }))
  }

  function handleDetectPython(): void {
    setDetecting(true)
    window.aeromind.mcp
      .detectPython()
      .then(({ path }) => {
        if (path) {
          update('command', path)
          message.success(`已检测到 Python: ${path}`)
        } else {
          message.warning('未检测到 Python，请手动填写路径')
        }
      })
      .catch(() => message.error('Python 检测失败'))
      .finally(() => setDetecting(false))
  }

  function handleDetectCatiaServer(): void {
    window.aeromind.mcp
      .detectCatiaServer()
      .then(({ path, valid }) => {
        if (path) {
          update('cwd', path)
          if (valid) {
            message.success(`已检测到 CATIA MCP 服务器目录: ${path}`)
          } else {
            message.warning(`路径存在但未找到 catia_mcp 模块: ${path}`)
          }
        } else {
          message.warning('未检测到 CATIA MCP 服务器目录，请手动填写')
        }
      })
      .catch(() => message.error('CATIA 服务器路径检测失败'))
  }

  function handleDetectAbaqusServer(): void {
    window.aeromind.mcp
      .detectAbaqusServer()
      .then(({ path, valid }) => {
        if (path) {
          update('cwd', path)
          setArgsText(`${path}\\mcp_server.py`)
          if (valid) {
            message.success(`已检测到 Abaqus MCP 服务器目录: ${path}`)
          } else {
            message.warning(`路径存在但未找到 mcp_server.py: ${path}`)
          }
        } else {
          message.warning('未检测到 Abaqus MCP 服务器目录，请手动填写')
        }
      })
      .catch(() => message.error('Abaqus 服务器路径检测失败'))
  }

  function buildConfig(): McpServerFormValues {
    const args = argsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    const env: Record<string, string> = {}
    for (const e of envEntries) {
      if (e.key.trim()) env[e.key.trim()] = e.value
    }
    return { ...form, args, env }
  }

  async function handleTest(): Promise<void> {
    if (!form.name || !form.transport) {
      message.warning('请先填写名称和传输类型')
      return
    }
    if (form.transport === 'stdio' && !form.command) {
      message.warning('请填写 command (Python 路径)')
      return
    }
    if ((form.transport === 'http' || form.transport === 'sse') && !form.url) {
      message.warning('请填写 URL')
      return
    }
    const config = buildConfig()
    const result = await testConnection(config)
    setTestResult(result)
    if (result.success) {
      message.success(`连接成功，发现 ${result.toolCount} 个工具`)
    } else {
      message.error(`连接失败: ${result.error}`)
    }
  }

  async function handleSave(): Promise<void> {
    if (!form.name.trim()) {
      message.warning('请填写服务器名称')
      return
    }
    const config = buildConfig()
    if (initial) {
      const result = await updateServer(initial.id, config)
      if (result.success) {
        message.success('MCP 服务器已更新')
        onSaved()
        onClose()
      } else {
        message.error(result.error || '更新失败')
      }
    } else {
      const result = await createServer({ ...config, autoConnect: config.enabled })
      if (result.success) {
        message.success('MCP 服务器已创建')
        onSaved()
        onClose()
      } else {
        message.error(result.error || '创建失败')
      }
    }
  }

  const isStdio = form.transport === 'stdio'

  return (
    <Modal
      title={initial ? '编辑 MCP 服务器' : '新建 MCP 服务器'}
      open={open}
      onCancel={onClose}
      onOk={handleSave}
      okText={initial ? '保存' : '创建'}
      cancelText="取消"
      width={640}
      destroyOnClose
    >
      <Form layout="vertical" className="mt-4">
        <div className="grid grid-cols-3 gap-3">
          <Form.Item label="图标" className="col-span-1">
            <Input
              value={form.icon || ''}
              onChange={(e) => update('icon', e.target.value)}
              maxLength={4}
              placeholder="🔌"
            />
          </Form.Item>
          <Form.Item label="名称" required className="col-span-2">
            <Input value={form.name} onChange={(e) => update('name', e.target.value)} placeholder="例如 CATIA V5" />
          </Form.Item>
        </div>

        <Form.Item label="描述">
          <Input
            value={form.description || ''}
            onChange={(e) => update('description', e.target.value)}
            placeholder="可选，简要描述此 MCP 服务器用途"
          />
        </Form.Item>

        <Form.Item label="传输类型">
          <Select
            value={form.transport}
            onChange={(v: McpTransport) => update('transport', v)}
            options={[
              { value: 'stdio', label: 'stdio（本地子进程，如 Python MCP）' },
              { value: 'http', label: 'http（Streamable HTTP）' },
              { value: 'sse', label: 'sse（Server-Sent Events）' }
            ]}
          />
        </Form.Item>

        {isStdio ? (
          <>
            <Form.Item
              label={
                <Space>
                  <span>命令 (command)</span>
                  <Button size="small" icon={<ThunderboltOutlined />} loading={detecting} onClick={handleDetectPython}>
                    检测 Python
                  </Button>
                </Space>
              }
              required
            >
              <Input
                value={form.command || ''}
                onChange={(e) => update('command', e.target.value)}
                placeholder="例如 C:\\Python311\\python.exe 或 python"
              />
            </Form.Item>

            <Form.Item label="参数 (args，每行一个)">
              <Input.TextArea
                value={argsText}
                onChange={(e) => setArgsText(e.target.value)}
                rows={2}
                placeholder={'-m\n-catia_mcp'}
              />
            </Form.Item>

            <Form.Item
              label={
                <Space>
                  <span>工作目录 (cwd)</span>
                  {template?.id === 'template-catia' && (
                    <Button size="small" icon={<FolderOpenOutlined />} onClick={handleDetectCatiaServer}>
                      检测 CATIA 路径
                    </Button>
                  )}
                  {template?.id === 'template-abaqus' && (
                    <Button size="small" icon={<FolderOpenOutlined />} onClick={handleDetectAbaqusServer}>
                      检测 Abaqus 路径
                    </Button>
                  )}
                </Space>
              }
            >
              <Input
                value={form.cwd || ''}
                onChange={(e) => update('cwd', e.target.value)}
                placeholder="例如 E:\\lijx\\plane3d\\3D_software_mcp\\catia-v5-mcp-server"
              />
            </Form.Item>

            <Form.Item label="环境变量 (env)">
              <div className="space-y-2">
                {envEntries.map((entry, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <Input
                      className="col-span-5"
                      value={entry.key}
                      onChange={(e) => updateEnvEntry(idx, { key: e.target.value }, envEntries, setEnvEntries)}
                      placeholder="变量名"
                    />
                    <Input
                      className="col-span-6"
                      value={entry.value}
                      onChange={(e) => updateEnvEntry(idx, { value: e.target.value }, envEntries, setEnvEntries)}
                      placeholder="值"
                    />
                    <Button
                      className="col-span-1"
                      type="text"
                      danger
                      onClick={() => setEnvEntries(envEntries.filter((_, i) => i !== idx))}
                    >
                      ×
                    </Button>
                  </div>
                ))}
                <Button size="small" onClick={() => setEnvEntries([...envEntries, { key: '', value: '' }])}>
                  + 添加变量
                </Button>
              </div>
            </Form.Item>
          </>
        ) : (
          <Form.Item label="服务器 URL" required>
            <Input
              value={form.url || ''}
              onChange={(e) => update('url', e.target.value)}
              placeholder="例如 http://localhost:8080/mcp"
            />
          </Form.Item>
        )}

        <div className="grid grid-cols-2 gap-4 mt-2">
          <Form.Item label="启用">
            <Switch checked={form.enabled} onChange={(v) => update('enabled', v)} />
          </Form.Item>
          <Form.Item label="应用启动时自动连接">
            <Switch checked={form.auto_start} onChange={(v) => update('auto_start', v)} />
          </Form.Item>
        </div>

        <div className="flex justify-between items-center mt-2">
          <Button icon={<ExperimentOutlined />} loading={testing} onClick={handleTest}>
            测试连接
          </Button>
          {testResult && (
            <span className={testResult.success ? 'text-green-600 text-xs' : 'text-red-600 text-xs'}>
              {testResult.success
                ? `✓ 发现 ${testResult.toolCount} 个工具`
                : `✗ ${testResult.error}`}
            </span>
          )}
        </div>

        {testResult?.success && testResult.tools.length > 0 && (
          <Alert
            type="info"
            className="mt-3"
            message={`工具列表（前 10 个）`}
            description={
              <ul className="text-xs max-h-32 overflow-y-auto m-0 p-0 list-none">
                {testResult.tools.slice(0, 10).map((t) => (
                  <li key={t.name} className="py-0.5">
                    <code className="text-blue-600">{t.name}</code>
                    <span className="text-gray-500 ml-2">{t.description}</span>
                  </li>
                ))}
                {testResult.tools.length > 10 && <li className="text-gray-400">...共 {testResult.tools.length} 个</li>}
              </ul>
            }
          />
        )}
      </Form>
    </Modal>
  )
}

function updateEnvEntry(idx: number, patch: Partial<EnvEntry>, entries: EnvEntry[], setter: (e: EnvEntry[]) => void): void {
  setter(entries.map((e, i) => (i === idx ? { ...e, ...patch } : e)))
}
