import { useState, useRef, useEffect, useMemo } from 'react'
import { SendOutlined, PaperClipOutlined, SearchOutlined, StopOutlined, ExportOutlined, CloseOutlined, FileTextOutlined, LoadingOutlined, CheckCircleOutlined, ExclamationCircleOutlined, DownOutlined, RobotOutlined, FolderOpenOutlined } from '@ant-design/icons'
import { message, Dropdown, Tooltip, Radio } from 'antd'
import type { MenuProps } from 'antd'
import { useCustomAgentStore } from '../../stores/customAgentStore'
import { useChatStore } from '../../stores/chatStore'
import type { CustomAgentData } from '../../types/customAgent'
import AgentIcon from '../AgentIcon'

interface AttachmentState {
  id: string
  fileName: string
  filePath: string
  status: 'parsing' | 'done' | 'error'
  parsed?: {
    fileName: string
    fileType: string
    content: string
    metadata?: {
      pages?: number
      sheets?: string[]
      rows?: number
    }
    error?: string
  }
}

interface ChatInputProps {
  onSend: (content: string) => void
  onAbort: () => void
  isStreaming: boolean
  disabled?: boolean
  onExport?: () => void
  exportMenuItems?: MenuProps['items']
}

function formatAttachmentContent(parsed: NonNullable<AttachmentState['parsed']>): string {
  if (parsed.error) {
    return `[附件: ${parsed.fileName}]\n解析失败: ${parsed.error}\n`
  }
  const metaParts: string[] = []
  if (parsed.metadata?.pages) metaParts.push(`${parsed.metadata.pages}页`)
  if (parsed.metadata?.sheets) metaParts.push(`工作表: ${parsed.metadata.sheets.join(', ')}`)
  if (parsed.metadata?.rows) metaParts.push(`${parsed.metadata.rows}行`)
  const metaLine = metaParts.length > 0 ? ` (${metaParts.join(', ')})` : ''

  return [
    `[附件: ${parsed.fileName}${metaLine}]`,
    '---文件内容开始---',
    parsed.content || '(文件内容为空)',
    '---文件内容结束---'
  ].join('\n')
}

let attachmentIdCounter = 0

export default function ChatInput({ onSend, onAbort, isStreaming, disabled, onExport, exportMenuItems }: ChatInputProps): JSX.Element {
  const [input, setInput] = useState('')
  const [attachments, setAttachments] = useState<AttachmentState[]>([])
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // 从 chatStore 拉取待填入的 prompt（模板广场等场景预填，不自动发送）
  const pendingInput = useChatStore((s) => s.pendingInput)
  const clearPendingInput = useChatStore((s) => s.clearPendingInput)
  useEffect(() => {
    if (pendingInput) {
      setInput(pendingInput)
      clearPendingInput()
      // 等下一帧聚焦并自适应高度
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus()
          textareaRef.current.style.height = 'auto'
          textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px'
        }
      }, 0)
    }
  }, [pendingInput, clearPendingInput])

  // @ 自动补全状态
  const { builtinAgents, agents: customAgents, fetchBuiltinAgents, fetchAgents } = useCustomAgentStore()
  const [mentionOpen, setMentionOpen] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionActiveIndex, setMentionActiveIndex] = useState(0)

  useEffect(() => {
    if (builtinAgents.length === 0) fetchBuiltinAgents()
    if (customAgents.length === 0) fetchAgents()
  }, [builtinAgents.length, customAgents.length, fetchBuiltinAgents, fetchAgents])

  // 可 @ 的 agent 列表：内置 + 自定义（含 orchestrator，允许用户显式指定）
  const availableAgents = useMemo<CustomAgentData[]>(() => {
    return [
      ...builtinAgents,
      ...customAgents
    ]
  }, [builtinAgents, customAgents])

  // 按 query 过滤（匹配 id 或 name，大小写不敏感，最多 8 项）
  const filteredAgents = useMemo<CustomAgentData[]>(() => {
    const q = mentionQuery.toLowerCase()
    const filtered = q
      ? availableAgents.filter(
          (a) => a.id.toLowerCase().includes(q) || a.name.toLowerCase().includes(q)
        )
      : availableAgents
    return filtered.slice(0, 8)
  }, [availableAgents, mentionQuery])

  // 当过滤列表变化时，重置高亮索引
  useEffect(() => {
    setMentionActiveIndex(0)
  }, [mentionQuery])

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 160) + 'px'
    }
  }, [input])

  const handleSend = (): void => {
    const trimmed = input.trim()
    if ((!trimmed && attachments.length === 0) || isStreaming || disabled) return

    const parts: string[] = []
    if (trimmed) parts.push(trimmed)

    for (const att of attachments) {
      if (att.parsed) {
        parts.push(formatAttachmentContent(att.parsed))
      } else if (att.status === 'error') {
        parts.push(`[附件: ${att.fileName}]\n文件解析失败\n`)
      }
    }

    onSend(parts.join('\n\n'))
    setInput('')
    setAttachments([])
    setMentionOpen(false)
  }

  // 检测光标前的 @mention 模式：要求 @ 在行首或空格之后（避免 email 误触发）
  const detectMention = (value: string, cursor: number): void => {
    const textBefore = value.slice(0, cursor)
    const match = textBefore.match(/(^|\s)@([\w一-龥-]*)$/)
    if (match) {
      const query = match[2]
      const atPosition = cursor - query.length - 1 // @ 字符的位置
      setMentionOpen(true)
      setMentionQuery(query)
      setMentionStart(atPosition)
    } else {
      setMentionOpen(false)
    }
  }

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>): void => {
    const value = e.target.value
    const cursor = e.target.selectionStart ?? value.length
    setInput(value)
    detectMention(value, cursor)
  }

  // 选中某个 agent，把 @query 替换为 @agent.id（带尾随空格）
  const selectAgent = (agent: CustomAgentData): void => {
    const before = input.slice(0, mentionStart)
    const after = input.slice(mentionStart + 1 + mentionQuery.length)
    const insertion = `@${agent.id} `
    const newValue = before + insertion + after
    setInput(newValue)
    setMentionOpen(false)
    // 恢复焦点并把光标放到插入文本之后
    setTimeout(() => {
      if (textareaRef.current) {
        const newCursor = before.length + insertion.length
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    // @ 自动补全开启时优先处理导航键
    if (mentionOpen && filteredAgents.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setMentionActiveIndex((prev) => (prev + 1) % filteredAgents.length)
        return
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        setMentionActiveIndex((prev) => (prev - 1 + filteredAgents.length) % filteredAgents.length)
        return
      }
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        selectAgent(filteredAgents[mentionActiveIndex])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        setMentionOpen(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleFileSelect = async (): Promise<void> => {
    const fileInput = document.createElement('input')
    fileInput.type = 'file'
    fileInput.multiple = true
    fileInput.accept = '.pdf,.docx,.doc,.xlsx,.csv,.txt,.md,.dat,.json'
    fileInput.onchange = async () => {
      if (!fileInput.files || fileInput.files.length === 0) return

      const newAttachments: AttachmentState[] = []

      for (const file of Array.from(fileInput.files)) {
        const id = `att-${++attachmentIdCounter}`
        // In Electron, File objects have a .path property pointing to the real file path
        const filePath = (file as any).path || file.name
        newAttachments.push({
          id,
          fileName: file.name,
          filePath,
          status: 'parsing'
        })
      }

      setAttachments((prev) => [...prev, ...newAttachments])

      for (const att of newAttachments) {
        try {
          const result = await window.aeromind.chat.uploadAttachment(att.filePath)
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === att.id
                ? { ...a, status: result.error ? 'error' : 'done', parsed: result }
                : a
            )
          )
        } catch (err: any) {
          setAttachments((prev) =>
            prev.map((a) =>
              a.id === att.id
                ? {
                    ...a,
                    status: 'error',
                    parsed: {
                      fileName: att.fileName,
                      fileType: 'unknown',
                      content: '',
                      error: err.message || '解析失败'
                    }
                  }
                : a
            )
          )
        }
      }
    }
    fileInput.click()
  }

  const removeAttachment = (id: string): void => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handleKbSearch = async (): Promise<void> => {
    if (!input.trim()) {
      message.info('请先输入关键词，再点击知识库检索')
      return
    }
    try {
      const results = await window.aeromind.kb.search(input.trim(), 3)
      if (results.length > 0) {
        const kbContext = results.map((r: any) => `[来源: ${r.file_name}]\n${r.content.substring(0, 200)}`).join('\n\n')
        setInput((prev) => prev + '\n\n---知识库参考---\n' + kbContext)
        message.success(`检索到 ${results.length} 条相关知识`)
      } else {
        message.info('知识库中未找到相关内容')
      }
    } catch {
      message.error('知识库检索失败')
    }
  }

  const hasContent = input.trim() || attachments.length > 0
  const allParsed = attachments.every((a) => a.status !== 'parsing')

  return (
    <div className="border-t border-gray-200 bg-white p-4">
      <div className="max-w-3xl mx-auto">
        {/* Attachment cards */}
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 mb-2">
            {attachments.map((att) => (
              <div
                key={att.id}
                className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                  att.status === 'error'
                    ? 'border-red-300 bg-red-50 text-red-700'
                    : att.status === 'done'
                    ? 'border-green-300 bg-green-50 text-green-700'
                    : 'border-blue-300 bg-blue-50 text-blue-700'
                }`}
              >
                <FileTextOutlined />
                <span className="max-w-[150px] truncate">{att.fileName}</span>
                {att.status === 'parsing' && <LoadingOutlined spin />}
                {att.status === 'done' && <CheckCircleOutlined />}
                {att.status === 'error' && <ExclamationCircleOutlined />}
                {att.parsed?.metadata?.pages && (
                  <span className="text-[10px] opacity-70">{att.parsed.metadata.pages}页</span>
                )}
                {att.parsed?.metadata?.sheets && att.parsed.metadata.sheets.length > 0 && (
                  <span className="text-[10px] opacity-70">{att.parsed.metadata.sheets.length}表</span>
                )}
                {att.parsed?.metadata?.rows && (
                  <span className="text-[10px] opacity-70">{att.parsed.metadata.rows}行</span>
                )}
                <button
                  onClick={() => removeAttachment(att.id)}
                  className="ml-1 hover:text-red-500 transition-colors"
                >
                  <CloseOutlined style={{ fontSize: 10 }} />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="relative flex items-end gap-2 rounded-card border border-gray-200 bg-white p-3 shadow-sm focus-within:border-primary focus-within:shadow-md transition-all">
          {/* @ 自动补全下拉列表 */}
          {mentionOpen && (
            <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-card border border-gray-200 shadow-lg max-h-64 overflow-y-auto z-50">
              {filteredAgents.length === 0 ? (
                <div className="px-3 py-3 text-sm text-gray-400 text-center">
                  {availableAgents.length === 0
                    ? '加载中...'
                    : `未找到匹配 "${mentionQuery}" 的 Agent`}
                </div>
              ) : (
                filteredAgents.map((agent, idx) => (
                  <button
                    key={agent.id}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      selectAgent(agent)
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-colors border-b border-gray-50 last:border-b-0 ${
                      idx === mentionActiveIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                    }`}
                  >
                    <AgentIcon
                      icon={agent.icon || 'assets/icons/orchestrator.svg'}
                      className="w-5 h-5"
                      style={{
                        width: '1.25rem',
                        height: '1.25rem',
                        flexShrink: 0
                      }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {agent.name}
                        <span className="ml-2 text-xs text-gray-400 font-mono">@{agent.id}</span>
                      </div>
                      {agent.description && (
                        <div className="text-xs text-gray-500 truncate">{agent.description}</div>
                      )}
                    </div>
                    {idx === mentionActiveIndex && (
                      <span className="text-xs text-blue-500 flex-shrink-0">Enter</span>
                    )}
                  </button>
                ))
              )}
            </div>
          )}

          {/* 附件按钮 */}
          <button
            onClick={handleFileSelect}
            className="flex-shrink-0 p-2 text-gray-400 hover:text-primary transition-colors"
            title="选择文件"
          >
            <PaperClipOutlined />
          </button>

          {/* 输入区域 */}
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onBlur={() => setTimeout(() => setMentionOpen(false), 150)}
            placeholder="请描述您的飞行器设计任务…（输入 @ 选择 Agent）"
            disabled={disabled}
            rows={1}
            className="flex-1 resize-none outline-none text-sm text-gray-900 placeholder:text-gray-300 min-h-[36px] max-h-[160px]"
          />

          {/* 知识库检索按钮 */}
          <button
            onClick={handleKbSearch}
            className="flex-shrink-0 p-2 text-gray-400 hover:text-primary transition-colors"
            title="知识库检索"
          >
            <SearchOutlined />
          </button>

          {/* 导出按钮 */}
          {exportMenuItems && exportMenuItems.length > 0 ? (
            <Dropdown menu={{ items: exportMenuItems }} trigger={['click']}>
              <button
                className="flex-shrink-0 p-2 text-gray-400 hover:text-primary transition-colors"
                title="导出对话"
              >
                <ExportOutlined />
              </button>
            </Dropdown>
          ) : onExport ? (
            <button
              onClick={onExport}
              className="flex-shrink-0 p-2 text-gray-400 hover:text-primary transition-colors"
              title="导出对话"
            >
              <ExportOutlined />
            </button>
          ) : null}

          {/* 发送/停止按钮 */}
          {isStreaming ? (
            <button
              onClick={onAbort}
              className="flex-shrink-0 p-2 rounded-btn bg-red-500 text-white hover:bg-red-600 transition-colors"
              title="停止生成"
            >
              <StopOutlined />
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!hasContent || disabled || !allParsed}
              className="flex-shrink-0 p-2 rounded-btn bg-primary text-white hover:bg-primary-dark disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              title="发送"
            >
              <SendOutlined />
            </button>
          )}
        </div>

        {/* Agent 模式选择器 */}
        <AgentModeSelector />
      </div>
    </div>
  )
}

// Agent 模式选择器：单按钮 + 下拉选 agent，默认普通对话
// 选中后高亮，状态存 chatStore.selectedAgent，发送时透传到主进程
function AgentModeSelector(): JSX.Element {
  const selectedAgent = useChatStore((s) => s.selectedAgent)
  const setSelectedAgent = useChatStore((s) => s.setSelectedAgent)
  const dispatchMode = useChatStore((s) => s.dispatchMode)
  const setDispatchMode = useChatStore((s) => s.setDispatchMode)
  const { builtinAgents, agents: customAgents } = useCustomAgentStore()

  const agentList = useMemo<CustomAgentData[]>(() => {
    return [
      ...builtinAgents,
      ...customAgents
    ]
  }, [builtinAgents, customAgents])

  const current = useMemo<CustomAgentData | undefined>(() => {
    return agentList.find((a) => a.id === selectedAgent) || agentList.find((a) => a.id === 'general')
  }, [agentList, selectedAgent])

  // 协调 Agent (orchestrator) 是调度器而非对话目标，协同调度已由独立开关控制，故从下拉框移除
  const menuItems = agentList
    .filter((a) => a.id !== 'orchestrator')
    .map((a) => ({
      key: a.id,
      label: (
        <div className="flex items-center gap-2 py-0.5">
          <AgentIcon
            icon={a.icon || 'assets/icons/orchestrator.svg'}
            className="w-4 h-4"
            style={{
              width: '1rem',
              height: '1rem',
              flexShrink: 0
            }}
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900 truncate">{a.name}</div>
            {a.description && (
              <div className="text-xs text-gray-400 truncate">{a.description}</div>
            )}
          </div>
          {a.id === selectedAgent && <CheckCircleOutlined style={{ color: '#1677FF' }} />}
        </div>
      ),
      onClick: () => setSelectedAgent(a.id)
    }))

  const isGeneral = selectedAgent === 'general'
  const color = current?.color || '#1677FF'
  const isCollaborative = dispatchMode === 'collaborative'

  return (
    <div className="flex items-center justify-between mt-2 px-1">
      <div className="flex items-center gap-2">
        <Dropdown menu={{ items: menuItems }} trigger={['click']} placement="topLeft" disabled={isCollaborative}>
          <button
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
              isGeneral
                ? 'bg-blue-50 text-blue-600 border-blue-200 hover:bg-blue-100'
                : 'text-white border-transparent shadow-sm hover:opacity-90'
            } ${isCollaborative ? 'opacity-50 cursor-not-allowed' : ''}`}
            style={isGeneral ? undefined : { backgroundColor: color }}
            title={isCollaborative ? '协同调度模式下由系统自动调度' : '选择对话目标 Agent'}
          >
            <RobotOutlined />
            <span className="max-w-[120px] truncate">{current?.name || '普通对话'}</span>
            <DownOutlined style={{ fontSize: 10 }} />
          </button>
        </Dropdown>
        <Radio.Group
          size="small"
          value={dispatchMode}
          onChange={(e) => setDispatchMode(e.target.value)}
          optionType="button"
          buttonStyle="solid"
        >
          <Radio.Button value="single">单 Agent</Radio.Button>
          <Radio.Button value="collaborative">协同调度</Radio.Button>
        </Radio.Group>
        <FileWorkspaceButton />
      </div>
      <span className="text-[11px] text-gray-400">
        {isCollaborative
          ? '协同调度模式 · 根据问题自动调度多 Agent · 输入 @ 可临时指定单 Agent'
          : isGeneral
            ? '单 Agent · 普通对话 · 输入 @ 指定专业 Agent'
            : `单 Agent · ${current?.name || ''} · 输入 @ 可临时覆盖`}
      </span>
    </div>
  )
}

// 工作空间按钮：选择 agent 文件读写工具的合法根目录
// 路径持久化在 settings.fileWorkspacePath，未设置时 agent 无文件工具
function FileWorkspaceButton(): JSX.Element {
  const [wsPath, setWsPath] = useState('')

  useEffect(() => {
    window.aeromind.settings.get('fileWorkspacePath').then((p: unknown) => {
      setWsPath((p as string) || '')
    })
  }, [])

  const handlePick = async (): Promise<void> => {
    const picked = await window.aeromind.fileWorkspace.pickFolder()
    if (picked) {
      await window.aeromind.settings.set('fileWorkspacePath', picked)
      setWsPath(picked)
      message.success(`已设置工作空间: ${picked}`)
    }
  }

  const handleClear = async (e: React.MouseEvent): Promise<void> => {
    e.stopPropagation()
    await window.aeromind.settings.set('fileWorkspacePath', '')
    setWsPath('')
    message.success('已清空工作空间，Agent 文件工具已禁用')
  }

  const set = wsPath !== ''
  const basename = set ? wsPath.split(/[\\/]/).pop() : ''

  return (
    <Tooltip title={set ? `工作空间: ${wsPath}` : '点击选择工作空间文件夹，设置后 Agent 可读写该目录内文件'}>
      <button
        onClick={handlePick}
        className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-all border ${
          set
            ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
            : 'bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100'
        }`}
      >
        <FolderOpenOutlined />
        <span className="max-w-[140px] truncate">{set ? basename : '工作空间：未设置'}</span>
        {set && (
          <CloseOutlined
            style={{ fontSize: 9 }}
            onClick={handleClear}
            className="hover:text-red-500"
          />
        )}
      </button>
    </Tooltip>
  )
}
