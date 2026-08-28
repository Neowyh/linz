import { useNavigate, useLocation } from 'react-router-dom'
import { useEffect, useState, useMemo, useRef } from 'react'
import {
  PlusOutlined,
  ClockCircleOutlined,
  AppstoreOutlined,
  FileTextOutlined,
  TeamOutlined,
  SettingOutlined,
  MessageOutlined,
  DeleteOutlined,
  EditOutlined,
  SearchOutlined,
  RobotOutlined,
  RocketOutlined,
  DoubleLeftOutlined
} from '@ant-design/icons'
import { Popconfirm, Input, message } from 'antd'
import { useConversationStore } from '../../stores/conversationStore'
import { useSettingsStore } from '../../stores/settingsStore'
import { useUIStore } from '../../stores/uiStore'
import WorkspaceSwitcher from './WorkspaceSwitcher'

interface NavItem {
  icon: React.ReactNode
  label: string
  path: string
}

const mainNavItems: NavItem[] = [
  { icon: <PlusOutlined />, label: '新建对话', path: '/chat' },
  { icon: <ClockCircleOutlined />, label: '自动任务', path: '/auto-tasks' },
  { icon: <AppstoreOutlined />, label: '模板广场', path: '/templates' },
  { icon: <RobotOutlined />, label: '智能体管理', path: '/agents' }
]

const knowledgeItems: NavItem[] = [
  { icon: <FileTextOutlined />, label: '文档库', path: '/knowledge' }
]

export default function Sidebar(): JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const conversations = useConversationStore((s) => s.conversations)
  const fetchConversations = useConversationStore((s) => s.fetchConversations)
  const createConversation = useConversationStore((s) => s.createConversation)
  const deleteConversation = useConversationStore((s) => s.deleteConversation)
  const setShowSettings = useSettingsStore((s) => s.setShowSettings)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const ollamaEnabled = useSettingsStore((s) => s.ollama.enabled)
  const toggleLeftPanel = useUIStore((s) => s.toggleLeftPanel)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [modelLabel, setModelLabel] = useState('DeepSeek')
  const [modelProvider, setModelProvider] = useState<'cloud' | 'ollama' | 'offline'>('cloud')
  const searchInputRef = useRef<any>(null)

  // 菜单"编辑 → 搜索对话"(Ctrl+F) 聚焦侧边栏搜索框
  useEffect(() => {
    const handleFocusSearch = (): void => {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
    window.addEventListener('menu:focus-search', handleFocusSearch)
    return () => {
      window.removeEventListener('menu:focus-search', handleFocusSearch)
    }
  }, [])

  const filteredConversations = useMemo(() => {
    if (!searchTerm.trim()) return conversations
    return conversations.filter((c) => (c.title || '新对话').toLowerCase().includes(searchTerm.toLowerCase()))
  }, [conversations, searchTerm])

  useEffect(() => {
    fetchConversations()
    loadSettings()
    // Load model status
    window.aeromind.ollama.status().then((status) => {
      setModelProvider(status.provider as 'cloud' | 'ollama' | 'offline')
      setModelLabel(status.label)
    }).catch(() => {
      setModelProvider('offline')
      setModelLabel('离线')
    })
  }, [fetchConversations, loadSettings, ollamaEnabled])

  // 自动任务（含测试运行）在主进程创建/更新 [自动] 对话，完成后刷新对话列表，
  // 否则要等重启才能看到
  useEffect(() => {
    const unsubscribe = window.aeromind.autoTask.onNotification(() => {
      fetchConversations()
    })
    return unsubscribe
  }, [fetchConversations])

  const handleNewChat = async (): Promise<void> => {
    const id = await createConversation()
    navigate(`/chat/${id}`)
  }

  const isActive = (path: string): boolean => {
    if (path === '/chat') {
      return location.pathname === '/' || location.pathname.startsWith('/chat')
    }
    return location.pathname === path
  }

  const handleDelete = async (e: React.MouseEvent, id: string): Promise<void> => {
    e.stopPropagation()
    await deleteConversation(id)
    // 如果当前正在查看该对话，导航到新对话页
    if (location.pathname === `/chat/${id}`) {
      navigate('/chat')
    }
    message.success('对话已删除')
  }

  const handleRename = (e: React.MouseEvent, id: string, currentTitle: string): void => {
    e.stopPropagation()
    setEditingId(id)
    setEditTitle(currentTitle || '新对话')
  }

  const handleRenameSubmit = async (id: string): Promise<void> => {
    if (editTitle.trim()) {
      await window.aeromind.conversation.rename(id, editTitle.trim())
      fetchConversations()
    }
    setEditingId(null)
  }

  return (
    <div className="w-[260px] min-w-[260px] h-full flex flex-col bg-white border-r border-line text-gray-700">
      {/* Logo */}
      <div className="px-5 py-4 flex items-center gap-2.5">
        <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-card">
          <RocketOutlined className="text-white text-base" />
        </div>
        <span className="text-base font-semibold tracking-wide text-gray-900">临智 LINZ</span>
        <button
          onClick={toggleLeftPanel}
          className="ml-auto p-1.5 text-gray-400 hover:text-primary hover:bg-gray-100 rounded transition-colors"
          title="隐藏侧边栏"
          aria-label="隐藏侧边栏"
        >
          <DoubleLeftOutlined style={{ fontSize: 12 }} />
        </button>
      </div>

      {/* 工作区切换器 */}
      <div className="px-3 mb-2">
        <WorkspaceSwitcher />
      </div>

      {/* 全局搜索 */}
      <div className="px-3 mb-2">
        <Input
          ref={searchInputRef}
          prefix={<SearchOutlined className="text-gray-400" />}
          placeholder="搜索对话..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="bg-gray-50 border-transparent hover:bg-gray-100 text-xs"
          size="small"
          allowClear
        />
      </div>

      {/* 新建对话按钮 */}
      <div className="px-3 mb-2">
        <button
          onClick={handleNewChat}
          className="w-full py-2 px-4 rounded-btn bg-primary hover:bg-primary-dark text-white text-sm font-medium flex items-center justify-center gap-2 transition-colors shadow-card"
        >
          <PlusOutlined /> 新建对话
        </button>
      </div>

      {/* 主导航 */}
      <nav className="flex-1 overflow-y-auto px-3">
        <div className="space-y-0.5">
          {mainNavItems.slice(1).map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full text-left py-2 px-4 rounded-btn text-sm flex items-center gap-3 transition-colors ${
                isActive(item.path)
                  ? 'bg-primary-light text-primary font-medium'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {/* 本地知识库 */}
        <div className="mt-4">
          <div className="px-4 py-1 text-xs text-gray-400 uppercase tracking-wider">本地知识库</div>
          {knowledgeItems.map((item) => (
            <button
              key={item.path}
              onClick={() => navigate(item.path)}
              className={`w-full text-left py-2 px-4 rounded-btn text-sm flex items-center gap-3 transition-colors ${
                isActive(item.path)
                  ? 'bg-primary-light text-primary font-medium'
                  : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        {/* 办公室 */}
        <div className="mt-2">
          <button
            onClick={() => navigate('/office')}
            className={`w-full text-left py-2 px-4 rounded-btn text-sm flex items-center gap-3 transition-colors ${
              isActive('/office')
                ? 'bg-primary-light text-primary font-medium'
                : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
            }`}
          >
            <TeamOutlined />
            办公室
          </button>
        </div>

        {/* 最近对话 */}
        <div className="mt-4">
          <div className="px-4 py-1 text-xs text-gray-400 uppercase tracking-wider">最近对话</div>
          <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
            {filteredConversations.map((conv) => (
              <div
                key={conv.id}
                onClick={() => navigate(`/chat/${conv.id}`)}
                className={`group w-full text-left py-1.5 px-3 rounded-btn text-xs flex items-center gap-2 transition-colors cursor-pointer ${
                  location.pathname === `/chat/${conv.id}`
                    ? 'bg-primary-light text-primary font-medium'
                    : 'text-gray-500 hover:bg-gray-100 hover:text-gray-900'
                }`}
              >
                <MessageOutlined className="text-[10px] flex-shrink-0" />
                {editingId === conv.id ? (
                  <Input
                    size="small"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    onPressEnter={() => handleRenameSubmit(conv.id)}
                    onBlur={() => handleRenameSubmit(conv.id)}
                    className="flex-1"
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="truncate flex-1">{conv.title || '新对话'}</span>
                )}
                {/* 操作按钮，hover 时显示 */}
                <div className="hidden group-hover:flex items-center gap-0.5 flex-shrink-0">
                  <button
                    onClick={(e) => handleRename(e, conv.id, conv.title || '')}
                    className="p-0.5 text-gray-400 hover:text-primary transition-colors"
                    title="重命名"
                  >
                    <EditOutlined style={{ fontSize: 10 }} />
                  </button>
                  <Popconfirm
                    title="确定删除此对话？"
                    onConfirm={(e) => { if (e) handleDelete(e, conv.id) }}
                    onCancel={(e) => e?.stopPropagation()}
                    okText="删除"
                    cancelText="取消"
                  >
                    <button
                      onClick={(e) => e.stopPropagation()}
                      className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
                      title="删除"
                    >
                      <DeleteOutlined style={{ fontSize: 10 }} />
                    </button>
                  </Popconfirm>
                </div>
              </div>
            ))}
          </div>
        </div>
      </nav>

      {/* 底部设置 + 模型状态 */}
      <div className="px-3 py-3 border-t border-line-light">
        {/* 模型状态指示器 */}
        <div className="flex items-center gap-2 px-4 py-1.5 mb-1">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${
              modelProvider === 'cloud'
                ? 'bg-green-500'
                : modelProvider === 'ollama'
                  ? 'bg-blue-500'
                  : 'bg-gray-400'
            }`}
          />
          <span className="text-xs text-gray-500 truncate">{modelLabel}</span>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="w-full text-left py-2 px-4 rounded-btn text-sm flex items-center gap-3 text-gray-600 hover:bg-gray-100 hover:text-gray-900 transition-colors"
        >
          <SettingOutlined />
          设置
        </button>
      </div>
    </div>
  )
}
