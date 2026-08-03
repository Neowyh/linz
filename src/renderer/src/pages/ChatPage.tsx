import { useEffect, useCallback, useState } from 'react'
import { useParams } from 'react-router-dom'
import { message, Dropdown } from 'antd'
import { FileTextOutlined, FileWordOutlined, FilePdfOutlined, LayoutOutlined } from '@ant-design/icons'
import { useChatStore } from '../stores/chatStore'
import { useSettingsStore } from '../stores/settingsStore'
import { useUIStore } from '../stores/uiStore'
import { useChat } from '../hooks/useChat'
import ChatInput from '../components/Chat/ChatInput'
import MessageList from '../components/Chat/MessageList'
import TaskTemplate, { DEFAULT_TASK_TEMPLATES } from '../components/Chat/TaskTemplate'
import AgentIcon from '../components/AgentIcon'
import {
  exportConversationMarkdown,
  exportConversationWord,
  exportConversationPdf
} from '../utils/exportChat'

export default function ChatPage(): JSX.Element {
  const messages = useChatStore((s) => s.messages)
  const isStreaming = useChatStore((s) => s.isStreaming)
  const isConfigured = useSettingsStore((s) => s.isConfigured)
  const setShowSettings = useSettingsStore((s) => s.setShowSettings)
  const { sendMessage, abort, loadConversation, conversationId } = useChat()
  const { conversationId: urlConvId } = useParams<{ conversationId?: string }>()

  useEffect(() => {
    if (urlConvId && urlConvId !== conversationId) {
      loadConversation(urlConvId)
    } else if (!urlConvId) {
      useChatStore.getState().setConversation(null)
      useChatStore.getState().clearMessages()
    }
  }, [urlConvId])

  const handleTemplateClick = (prompt: string): void => {
    sendMessage(prompt)
  }

  // 导出对话（复用 utils/exportChat，与菜单"文件 → 导出对话"共用同一实现）
  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async () => {
    if (messages.length === 0 || exporting) return
    setExporting(true)
    try {
      await exportConversationMarkdown(messages)
    } catch (err: any) {
      message.error(`导出失败: ${err.message || '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }, [messages, exporting])

  const handleExportWord = useCallback(async () => {
    if (messages.length === 0 || exporting) return
    setExporting(true)
    try {
      await exportConversationWord(messages)
    } catch (err: any) {
      message.error(`导出失败: ${err.message || '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }, [messages, exporting])

  const handleExportPDF = useCallback(async () => {
    if (messages.length === 0 || exporting) return
    setExporting(true)
    try {
      await exportConversationPdf(messages)
    } catch (err: any) {
      message.error(`导出失败: ${err.message || '未知错误'}`)
    } finally {
      setExporting(false)
    }
  }, [messages, exporting])

  const exportMenuItems = [
    {
      key: 'markdown',
      label: '导出为 Markdown',
      icon: <FileTextOutlined />,
      onClick: handleExport
    },
    {
      key: 'word',
      label: '导出为 Word (.docx)',
      icon: <FileWordOutlined />,
      onClick: handleExportWord
    },
    {
      key: 'pdf',
      label: '导出为 PDF',
      icon: <FilePdfOutlined />,
      onClick: handleExportPDF
    }
  ]

  const showWelcome = messages.length === 0 && !urlConvId
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel)
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen)

  return (
    <div className="h-full flex flex-col relative">
      <button
        onClick={toggleRightPanel}
        className={`absolute top-3 right-4 z-20 p-2 rounded transition-colors ${
          rightPanelOpen
            ? 'text-primary bg-primary/10 hover:bg-primary/20'
            : 'text-gray-500 hover:text-primary hover:bg-gray-100'
        }`}
        title={rightPanelOpen ? '隐藏侧边栏' : '显示侧边栏'}
      >
        <LayoutOutlined />
      </button>
      {showWelcome ? (
        <div className="flex-1 flex flex-col items-center justify-center px-6 overflow-y-auto py-8">
          <div className="text-center mb-8">
            <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-white shadow-card flex items-center justify-center">
              <AgentIcon icon="assets/icons/orchestrator.svg" className="w-12 h-12" />
            </div>
            <h1 className="text-2xl font-semibold text-gray-900 mb-1.5 tracking-wide">临智 LINZ</h1>
            <p className="text-gray-500 text-sm">对话即设计 · 为您的飞行器设计 24 小时待命</p>
          </div>

          {!isConfigured && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-300 rounded-card max-w-md text-center shadow-card">
              <p className="text-sm text-amber-700 mb-2">请先配置 API Key 以使用对话功能</p>
              <button
                onClick={() => setShowSettings(true)}
                className="px-4 py-1.5 bg-primary text-white rounded-btn text-sm hover:bg-primary-dark transition-colors shadow-card"
              >
                前往设置
              </button>
            </div>
          )}

          <div className="w-full max-w-2xl mb-8">
            <ChatInput onSend={sendMessage} onAbort={abort} isStreaming={isStreaming} disabled={!isConfigured} />
          </div>

          <div className="w-full max-w-2xl">
            <p className="text-xs text-gray-400 mb-3 text-center tracking-wider">推荐任务</p>
            <div className="grid grid-cols-2 gap-3">
              {DEFAULT_TASK_TEMPLATES.map((tpl) => (
                <TaskTemplate key={tpl.id} template={tpl} onClick={handleTemplateClick} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <>
          <MessageList messages={messages} />
          <ChatInput onSend={sendMessage} onAbort={abort} isStreaming={isStreaming} disabled={!isConfigured} exportMenuItems={exportMenuItems} />
        </>
      )}
    </div>
  )
}
