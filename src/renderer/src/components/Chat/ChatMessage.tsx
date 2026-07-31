import { FileTextOutlined, FileWordOutlined, DownloadOutlined, ToolOutlined, BulbOutlined, CheckCircleFilled, LoadingOutlined } from '@ant-design/icons'
import { message as antdMessage, Collapse } from 'antd'
import { useState } from 'react'
import type { ChatMessage as ChatMessageType, ToolCallEntry } from '../../types/chat'
import { resolveAgentDisplaySnapshot } from '../../utils/agentDisplay'
import MarkdownRenderer from '../Markdown/MarkdownRenderer'
import AgentBadge from './AgentBadge'

interface ChatMessageProps {
  message: ChatMessageType
}

interface AttachmentCardData {
  fileName: string
  meta?: string
  error?: string
}

// 附件内容块标记（与 ChatInput.formatAttachmentContent / parsers.formatAttachmentContent 保持一致）
const ATTACHMENT_CONTENT_START = '---文件内容开始---'
const ATTACHMENT_CONTENT_END = '---文件内容结束---'

// 从用户消息中剥离附件内容块，返回（展示文本, 附件卡片列表）
// 仅用于 UI 展示；完整内容仍原样存入 chatStore/DB 并发送给主进程，确保 Agent 可见。
function stripAttachmentContent(raw: string): { displayText: string; attachments: AttachmentCardData[] } {
  const attachments: AttachmentCardData[] = []
  const blockPattern = new RegExp(
    `(\\[附件:[^\\]]*\\])\\n(${ATTACHMENT_CONTENT_START.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')})[\\s\\S]*?${ATTACHMENT_CONTENT_END.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`,
    'g'
  )

  const legitimateHeaders = new Set<string>()
  let blockMatch: RegExpExecArray | null
  while ((blockMatch = blockPattern.exec(raw)) !== null) {
    legitimateHeaders.add(blockMatch[1])
  }

  let cleaned = raw

  for (const header of Array.from(legitimateHeaders)) {
    const body = header.slice('[附件:'.length, -1).trim()
    const metaMatch = body.match(/\(([^)]*)\)\s*$/)
    const fileName = (metaMatch ? body.slice(0, metaMatch.index) : body).trim()
    const meta = metaMatch ? metaMatch[1].trim() : undefined
    attachments.push({ fileName, meta })
  }

  cleaned = cleaned.replace(blockPattern, '').trim()

  const errorPattern = /\[附件:\s*([^\]]+)\]\n解析失败:[^\n]*\n?/g
  let errorMatch: RegExpExecArray | null
  while ((errorMatch = errorPattern.exec(cleaned)) !== null) {
    const fileName = errorMatch[1].trim()
    const existing = attachments.find((a) => a.fileName === fileName)
    if (existing) {
      existing.error = '解析失败'
    } else {
      attachments.push({ fileName, error: '解析失败' })
    }
  }
  cleaned = cleaned.replace(errorPattern, '').trim()

  const fallbackErrorPattern = /\[附件:\s*([^\]]+)\]\n文件解析失败\n?/g
  let fallbackMatch: RegExpExecArray | null
  while ((fallbackMatch = fallbackErrorPattern.exec(cleaned)) !== null) {
    const fileName = fallbackMatch[1].trim()
    const existing = attachments.find((a) => a.fileName === fileName)
    if (existing) {
      existing.error = '解析失败'
    } else {
      attachments.push({ fileName, error: '解析失败' })
    }
  }
  cleaned = cleaned.replace(fallbackErrorPattern, '').trim()

  cleaned = cleaned.replace(/\n{3,}/g, '\n\n').trim()

  return { displayText: cleaned, attachments }
}

// 工具调用卡片
function ToolCallCard({ call }: { call: ToolCallEntry }): JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const running = call.isComplete === false
  const hasOutput = call.output && call.output.length > 0
  const inputShort = call.input.length > 80 ? call.input.slice(0, 80) + '...' : call.input
  const outputShort = hasOutput && call.output.length > 80 ? call.output.slice(0, 80) + '...' : call.output

  return (
    <div className="border border-gray-200 rounded-md bg-gray-50/50 text-xs">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 hover:bg-gray-100 transition-colors"
      >
        <ToolOutlined style={{ fontSize: 12, color: '#1E6FCC' }} />
        <span className="font-mono font-medium text-primary">{call.tool}</span>
        {running ? (
          <span className="flex items-center gap-1 text-amber-600">
            <LoadingOutlined style={{ fontSize: 11 }} />
            <span>执行中</span>
          </span>
        ) : (
          <span className="flex items-center gap-1 text-green-600">
            <CheckCircleFilled style={{ fontSize: 11 }} />
            <span>已完成</span>
          </span>
        )}
        <span className="ml-auto text-gray-400">{expanded ? '收起' : '展开'}</span>
      </button>
      {(call.input || hasOutput) && (
        <div className={`px-3 pb-2 ${expanded ? 'block' : 'hidden'}`}>
          {call.input && (
            <div className="mt-1">
              <div className="text-[10px] text-gray-500 mb-0.5">输入</div>
              <pre className="font-mono text-[11px] bg-white border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-40">
                {call.input}
              </pre>
            </div>
          )}
          {hasOutput && (
            <div className="mt-2">
              <div className="text-[10px] text-gray-500 mb-0.5">输出</div>
              <pre className="font-mono text-[11px] bg-white border border-gray-200 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all max-h-60">
                {call.output}
              </pre>
            </div>
          )}
        </div>
      )}
      {!expanded && (inputShort || outputShort) && (
        <div className="px-3 pb-1.5 text-[10px] text-gray-500 font-mono truncate">
          {inputShort && <span className="mr-2">→ {inputShort}</span>}
          {outputShort && <span>← {outputShort}</span>}
        </div>
      )}
    </div>
  )
}

export default function ChatMessage({ message }: ChatMessageProps): JSX.Element {
  const isUser = message.role === 'user'
  const [exporting, setExporting] = useState<'word' | null>(null)

  const { displayText, attachments } = isUser
    ? stripAttachmentContent(message.content)
    : { displayText: message.content, attachments: [] as AttachmentCardData[] }

  const agentLabel = message.agentType
    ? resolveAgentDisplaySnapshot(message.agentType).name
    : '助手'
  const fileBase = `LINZ_${agentLabel}_${new Date().toISOString().slice(0, 10)}`

  const handleExportMarkdown = (): void => {
    if (!message.content) {
      antdMessage.warning('消息内容为空')
      return
    }
    const md = `# ${agentLabel} 回复\n\n导出时间: ${new Date().toLocaleString('zh-CN')}\n\n---\n\n${message.content}\n`
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${fileBase}.md`
    a.click()
    URL.revokeObjectURL(url)
    antdMessage.success('已导出为 Markdown')
  }

  const handleExportWord = async (): Promise<void> => {
    if (!message.content) {
      antdMessage.warning('消息内容为空')
      return
    }
    if (exporting) return
    setExporting('word')
    try {
      const filePath = await window.aeromind.export.saveDialog({
        format: 'word',
        defaultPath: `${fileBase}.docx`
      })
      if (!filePath) return
      const exportMessages = [{
        id: message.id,
        role: message.role,
        agentType: message.agentType,
        content: message.content,
        createdAt: message.createdAt
      }]
      const base64 = await window.aeromind.export.word(exportMessages, {
        includeAgentBadges: true,
        title: `${agentLabel} 回复`
      })
      await window.aeromind.export.saveFile(filePath, base64)
      antdMessage.success('已导出为 Word 文档')
    } catch (err: any) {
      antdMessage.error(`导出失败: ${err.message || '未知错误'}`)
    } finally {
      setExporting(null)
    }
  }

  const hasThinking = !isUser && message.thinking && message.thinking.trim().length > 0
  const hasToolCalls = !isUser && message.toolCalls && message.toolCalls.length > 0

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div className={`max-w-[80%] ${isUser ? 'order-2' : ''}`}>
        {!isUser && message.agentType && (
          <div className="mb-1">
            <AgentBadge agentType={message.agentType} />
          </div>
        )}

        <div
          className={`group relative rounded-2xl px-4 py-3 text-sm leading-relaxed ${
            isUser
              ? 'bg-primary text-white rounded-br-sm shadow-card'
              : 'bg-white border border-line-light shadow-card rounded-bl-sm'
          }`}
        >
          {isUser ? (
            <div className="space-y-2">
              {displayText && (
                <p className="whitespace-pre-wrap">{displayText}</p>
              )}
              {attachments.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {attachments.map((att, idx) => (
                    <div
                      key={`${att.fileName}-${idx}`}
                      className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs ${
                        att.error
                          ? 'border-red-200 bg-red-50 text-red-700'
                          : 'border-white/30 bg-white/10 text-white'
                      }`}
                    >
                      <FileTextOutlined />
                      <span className="max-w-[180px] truncate font-medium">{att.fileName}</span>
                      {att.meta && <span className="opacity-80 text-[10px]">{att.meta}</span>}
                      {att.error && <span className="text-[10px] opacity-90">{att.error}</span>}
                    </div>
                  ))}
                </div>
              )}
              {!displayText && attachments.length === 0 && (
                <p className="whitespace-pre-wrap opacity-60 text-xs">(空消息)</p>
              )}
            </div>
          ) : (
            <div className="prose prose-sm max-w-none space-y-2">
              {/* 思考过程：可折叠，默认流式时展开，结束后收起 */}
              {hasThinking && (
                <Collapse
                  ghost
                  size="small"
                  defaultActiveKey={message.isStreaming ? ['thinking'] : []}
                  className="thinking-collapse"
                  items={[{
                    key: 'thinking',
                    label: (
                      <span className="flex items-center gap-1.5 text-xs text-purple-600 font-medium">
                        <BulbOutlined />
                        <span>思考过程</span>
                        {message.isStreaming && (
                          <LoadingOutlined style={{ fontSize: 11 }} />
                        )}
                      </span>
                    ),
                    children: (
                      <pre className="font-mono text-[11px] text-gray-600 whitespace-pre-wrap bg-purple-50/50 border border-purple-100 rounded p-2 max-h-60 overflow-y-auto">
                        {message.thinking}
                      </pre>
                    )
                  }]}
                />
              )}

              {/* 工具调用卡片 */}
              {hasToolCalls && (
                <div className="space-y-1.5">
                  {message.toolCalls!.map((call, idx) => (
                    <ToolCallCard
                      key={call.toolCallId || `${call.tool}-${idx}`}
                      call={call}
                    />
                  ))}
                </div>
              )}

              {/* 主内容 */}
              {message.content ? (
                <MarkdownRenderer content={message.content} />
              ) : !hasThinking && !hasToolCalls ? (
                <span className="text-gray-400 text-xs italic">（等待响应...）</span>
              ) : null}
              {message.isStreaming && message.content && (
                <span className="inline-block w-2 h-4 bg-primary animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          )}

          {!isUser && !message.isStreaming && message.content && (
            <div className="absolute -bottom-3 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white border border-gray-200 rounded-full shadow-md px-1 py-0.5">
              <button
                onClick={handleExportMarkdown}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-gray-600 hover:text-primary hover:bg-gray-50 rounded-full transition-colors"
                title="导出为 Markdown"
              >
                <FileTextOutlined style={{ fontSize: 11 }} />
                <span>MD</span>
              </button>
              <button
                onClick={handleExportWord}
                disabled={exporting === 'word'}
                className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-gray-600 hover:text-primary hover:bg-gray-50 rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                title="导出为 Word"
              >
                {exporting === 'word' ? <DownloadOutlined style={{ fontSize: 11 }} /> : <FileWordOutlined style={{ fontSize: 11 }} />}
                <span>Word</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
