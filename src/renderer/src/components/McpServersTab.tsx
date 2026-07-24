import { useState, useEffect } from 'react'
import {
  Button, Card, Tag, Empty, Popconfirm, Switch, Dropdown, Modal, message, Spin, Space
} from 'antd'
import {
  PlusOutlined, EditOutlined, DeleteOutlined, ReloadOutlined,
  AppstoreOutlined, DownOutlined
} from '@ant-design/icons'
import { useMcpStore } from '../stores/mcpStore'
import type { McpServer, McpTemplate } from '../types/mcp'
import McpServerFormModal from './McpServerFormModal'

const STATUS_COLOR: Record<string, string> = {
  connected: 'green',
  connecting: 'blue',
  disconnected: 'default',
  error: 'red'
}

const STATUS_TEXT: Record<string, string> = {
  connected: '已连接',
  connecting: '连接中',
  disconnected: '未连接',
  error: '错误'
}

export default function McpServersTab(): JSX.Element {
  const {
    servers, templates, loading, fetchServers, fetchTemplates,
    deleteServer, connect, disconnect
  } = useMcpStore()

  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<McpServer | null>(null)
  const [applyTemplate, setApplyTemplate] = useState<McpTemplate | null>(null)
  const [toolsModalServer, setToolsModalServer] = useState<McpServer | null>(null)
  const [toolsList, setToolsList] = useState<Array<{ name: string; description: string }>>([])
  const [toolsLoading, setToolsLoading] = useState(false)

  useEffect(() => {
    fetchServers()
    fetchTemplates()
  }, [fetchServers, fetchTemplates])

  function openCreate(): void {
    setEditing(null)
    setApplyTemplate(null)
    setModalOpen(true)
  }

  function openFromTemplate(tpl: McpTemplate): void {
    setEditing(null)
    setApplyTemplate(tpl)
    setModalOpen(true)
  }

  function openEdit(server: McpServer): void {
    setEditing(server)
    setApplyTemplate(null)
    setModalOpen(true)
  }

  async function handleToggleEnabled(server: McpServer, enabled: boolean): Promise<void> {
    // 启停开关：开启时连接，关闭时断开
    if (enabled) {
      const result = await connect(server.id)
      if (result.success) {
        message.success(`已连接 ${server.name}（${result.toolCount} 个工具）`)
      } else {
        message.error(result.error || '连接失败')
      }
    } else {
      const result = await disconnect(server.id)
      if (result.success) {
        message.success(`已断开 ${server.name}`)
      } else {
        message.error(result.error || '断开失败')
      }
    }
  }

  async function handleReconnect(server: McpServer): Promise<void> {
    const result = await connect(server.id)
    if (result.success) {
      message.success(`已重新连接 ${server.name}（${result.toolCount} 个工具）`)
    } else {
      message.error(result.error || '重连失败')
    }
  }

  async function handleDelete(server: McpServer): Promise<void> {
    const result = await deleteServer(server.id)
    if (result.success) {
      message.success(`已删除 ${server.name}`)
    } else {
      message.error(result.error || '删除失败')
    }
  }

  async function showTools(server: McpServer): Promise<void> {
    setToolsModalServer(server)
    setToolsLoading(true)
    setToolsList([])
    try {
      const tools = await window.aeromind.mcp.listTools(server.id)
      setToolsList(tools)
    } catch (err) {
      message.error('工具列表加载失败')
    } finally {
      setToolsLoading(false)
    }
  }

  const templateMenu = {
    items: templates.map((t) => ({
      key: t.id,
      label: (
        <div className="flex items-center gap-2">
          <span>{t.icon}</span>
          <span>{t.name}</span>
          <span className="text-xs text-gray-500">— {t.description}</span>
        </div>
      ),
      onClick: () => openFromTemplate(t)
    }))
  }

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-600">
          MCP 服务器作为外部工具源，连接后其工具可在 Agent 编辑器中勾选使用
        </div>
        <Space>
          <Dropdown menu={templateMenu} disabled={templates.length === 0}>
            <Button icon={<AppstoreOutlined />}>
              从模板添加 <DownOutlined />
            </Button>
          </Dropdown>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
            添加服务器
          </Button>
        </Space>
      </div>

      {loading && servers.length === 0 ? (
        <div className="text-center py-8">
          <Spin />
        </div>
      ) : servers.length === 0 ? (
        <Empty description="尚未添加 MCP 服务器，点击「从模板添加」快速接入 CATIA V5">
          <Button type="primary" icon={<AppstoreOutlined />} onClick={() => templates[0] && openFromTemplate(templates[0])}>
            添加 CATIA V5 模板
          </Button>
        </Empty>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {servers.map((server) => (
            <Card
              key={server.id}
              size="small"
              className="shadow-sm hover:shadow-md transition-shadow"
              title={
                <div className="flex items-center gap-2">
                  <span className="text-xl">{server.icon || '🔌'}</span>
                  <span className="text-sm font-medium">{server.name}</span>
                </div>
              }
              extra={<Tag color={STATUS_COLOR[server.status]}>{STATUS_TEXT[server.status]}</Tag>}
            >
              <p className="text-xs text-gray-600 mb-2 line-clamp-2 min-h-[2em]">
                {server.description || '暂无描述'}
              </p>

              <div className="flex flex-wrap gap-2 mb-2 text-xs text-gray-500">
                <Tag>{server.transport}</Tag>
                <Tag
                  style={{ cursor: 'pointer' }}
                  color="blue"
                  onClick={() => showTools(server)}
                >
                  {server.tool_count} 工具
                </Tag>
                {server.last_connected_at && (
                  <span className="text-gray-400">
                    最后连接: {new Date(server.last_connected_at).toLocaleString()}
                  </span>
                )}
              </div>

              {server.last_error && server.status === 'error' && (
                <div className="text-xs text-red-600 mb-2 line-clamp-2" title={server.last_error}>
                  ⚠ {server.last_error}
                </div>
              )}

              <div className="flex items-center justify-between mt-2">
                <div className="flex items-center gap-2">
                  <Switch
                    size="small"
                    checked={server.status === 'connected' || server.status === 'connecting'}
                    onChange={(checked) => handleToggleEnabled(server, checked)}
                  />
                  <span className="text-xs text-gray-500">
                    {server.status === 'connected' ? '已启用' : '已停用'}
                  </span>
                </div>
                <div className="flex gap-1">
                  <Button
                    type="text"
                    size="small"
                    icon={<ReloadOutlined />}
                    title="重新连接"
                    onClick={() => handleReconnect(server)}
                    disabled={server.status === 'connecting'}
                  />
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => openEdit(server)}
                  />
                  <Popconfirm
                    title={`确定删除 ${server.name}？`}
                    onConfirm={() => handleDelete(server)}
                    okText="删除"
                    cancelText="取消"
                  >
                    <Button type="text" size="small" icon={<DeleteOutlined />} danger />
                  </Popconfirm>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <McpServerFormModal
        open={modalOpen}
        initial={editing}
        template={applyTemplate}
        onClose={() => setModalOpen(false)}
        onSaved={() => fetchServers()}
      />

      <Modal
        title={`${toolsModalServer?.name || ''} - 工具列表`}
        open={!!toolsModalServer}
        onCancel={() => setToolsModalServer(null)}
        footer={null}
        width={640}
      >
        {toolsLoading ? (
          <div className="text-center py-6">
            <Spin />
          </div>
        ) : toolsList.length === 0 ? (
          <Empty description="未发现工具，请确认服务器已连接" />
        ) : (
          <div className="max-h-[60vh] overflow-y-auto">
            {toolsList.map((tool) => (
              <div key={tool.name} className="py-2 border-b border-gray-100 last:border-0">
                <div className="text-sm font-mono text-blue-600">{tool.name}</div>
                <div className="text-xs text-gray-600 mt-0.5">{tool.description}</div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  )
}
