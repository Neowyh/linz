import { useEffect, useState } from 'react'
import {
  SwapOutlined,
  PlusOutlined,
  DeleteOutlined,
  EditOutlined,
  CheckOutlined,
  CloseOutlined,
  FolderOutlined
} from '@ant-design/icons'
import { Input, message, Popconfirm } from 'antd'

interface WorkspaceInfo {
  id: string
  name: string
  createdAt: string
  lastOpenedAt: string
}

export default function WorkspaceSwitcher(): JSX.Element {
  const [workspaces, setWorkspaces] = useState<WorkspaceInfo[]>([])
  const [current, setCurrent] = useState<WorkspaceInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')

  const loadData = async (): Promise<void> => {
    const [list, cur] = await Promise.all([
      window.aeromind.workspace.list(),
      window.aeromind.workspace.current()
    ])
    setWorkspaces(list)
    setCurrent(cur)
  }

  useEffect(() => {
    loadData()

    const unsubscribe = window.aeromind.workspace.onChanged(() => {
      // Reload the page when workspace changes (database switches)
      location.reload()
    })

    return unsubscribe
  }, [])

  const handleSwitch = async (id: string): Promise<void> => {
    if (id === current?.id) {
      setOpen(false)
      return
    }
    try {
      await window.aeromind.workspace.switch(id)
      // Page will reload via onChanged listener
    } catch (err: any) {
      message.error(`切换工作区失败: ${err.message}`)
    }
  }

  const handleCreate = async (): Promise<void> => {
    if (!newName.trim()) return
    try {
      await window.aeromind.workspace.create(newName.trim())
      setNewName('')
      setCreating(false)
      await loadData()
      message.success('工作区已创建')
    } catch (err: any) {
      message.error(`创建工作区失败: ${err.message}`)
    }
  }

  const handleDelete = async (id: string): Promise<void> => {
    try {
      const result = await window.aeromind.workspace.delete(id)
      if (result.success) {
        await loadData()
        message.success('工作区已删除')
      } else {
        message.error(result.error || '删除失败')
      }
    } catch (err: any) {
      message.error(`删除工作区失败: ${err.message}`)
    }
  }

  const handleRename = async (id: string): Promise<void> => {
    if (!editName.trim()) {
      setEditingId(null)
      return
    }
    try {
      await window.aeromind.workspace.rename(id, editName.trim())
      setEditingId(null)
      await loadData()
    } catch (err: any) {
      message.error(`重命名失败: ${err.message}`)
    }
  }

  return (
    <div className="relative">
      {/* Current workspace button */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full py-2 px-4 rounded-btn text-sm flex items-center gap-2 text-gray-300 hover:bg-sidebar-hover hover:text-white transition-colors"
      >
        <FolderOutlined />
        <span className="truncate flex-1 text-left">{current?.name || '默认项目'}</span>
        <SwapOutlined className="text-[10px] text-gray-500" />
      </button>

      {/* Dropdown */}
      {open && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />

          <div
            className="absolute left-3 top-full mt-1 w-[220px] border border-white/10 rounded-lg shadow-xl z-[1000] py-1"
            style={{ backgroundColor: '#2D2D50' }}
          >
            {/* Workspace list */}
            {workspaces.map((ws) => (
              <div
                key={ws.id}
                className={`flex items-center gap-1 px-3 py-2 cursor-pointer text-sm transition-colors ${
                  ws.id === current?.id
                    ? 'bg-primary/20 text-white'
                    : 'text-gray-300 hover:bg-white/5 hover:text-white'
                }`}
                onClick={() => handleSwitch(ws.id)}
              >
                {editingId === ws.id ? (
                  <div className="flex items-center gap-1 flex-1" onClick={(e) => e.stopPropagation()}>
                    <Input
                      size="small"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      onPressEnter={() => handleRename(ws.id)}
                      className="flex-1 text-xs"
                      autoFocus
                    />
                    <button
                      onClick={() => handleRename(ws.id)}
                      className="text-green-400 hover:text-green-300"
                    >
                      <CheckOutlined style={{ fontSize: 12 }} />
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-gray-400 hover:text-white"
                    >
                      <CloseOutlined style={{ fontSize: 12 }} />
                    </button>
                  </div>
                ) : (
                  <>
                    <FolderOutlined className="text-[10px] flex-shrink-0" />
                    <span className="truncate flex-1">{ws.name}</span>
                    <div className="hidden group-hover:flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => {
                          setEditingId(ws.id)
                          setEditName(ws.name)
                        }}
                        className="p-0.5 text-gray-500 hover:text-white"
                      >
                        <EditOutlined style={{ fontSize: 10 }} />
                      </button>
                      {workspaces.length > 1 && (
                        <Popconfirm
                          title="确定删除此工作区？数据将无法恢复。"
                          onConfirm={() => handleDelete(ws.id)}
                          okText="删除"
                          cancelText="取消"
                        >
                          <button className="p-0.5 text-gray-500 hover:text-red-400">
                            <DeleteOutlined style={{ fontSize: 10 }} />
                          </button>
                        </Popconfirm>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}

            {/* Divider */}
            <div className="border-t border-white/10 my-1" />

            {/* Create new workspace */}
            {creating ? (
              <div className="px-3 py-2 flex items-center gap-1">
                <Input
                  size="small"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onPressEnter={handleCreate}
                  placeholder="工作区名称"
                  className="flex-1 text-xs"
                  autoFocus
                />
                <button
                  onClick={handleCreate}
                  className="text-green-400 hover:text-green-300"
                >
                  <CheckOutlined style={{ fontSize: 12 }} />
                </button>
                <button
                  onClick={() => {
                    setCreating(false)
                    setNewName('')
                  }}
                  className="text-gray-400 hover:text-white"
                >
                  <CloseOutlined style={{ fontSize: 12 }} />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setCreating(true)}
                className="w-full px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/5 flex items-center gap-2 transition-colors"
              >
                <PlusOutlined />
                新建工作区
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
