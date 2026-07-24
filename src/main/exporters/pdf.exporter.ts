import { BrowserWindow } from 'electron'

export interface ExportMessage {
  id: string
  role: 'user' | 'assistant' | 'agent'
  agentType?: string
  content: string
  createdAt?: string
}

export interface ExportOptions {
  includeMetadata?: boolean
  includeAgentBadges?: boolean
  title?: string
}

const AGENT_COLORS: Record<string, string> = {
  orchestrator: '#722ED1',
  aero: '#1E6FCC',
  structural: '#FA8C16',
  propulsion: '#CF1322',
  avionics: '#08979C',
  simulation: '#722ED1',
  documentation: '#389E0D',
  retriever: '#1890FF'
}

const AGENT_NAMES: Record<string, string> = {
  orchestrator: '协调 Agent',
  aero: '气动 Agent',
  structural: '结构 Agent',
  propulsion: '推进 Agent',
  avionics: '航电 Agent',
  simulation: '仿真 Agent',
  documentation: '文档 Agent',
  retriever: '检索 Agent'
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function renderMarkdownAsHtml(content: string): string {
  let html = escapeHtml(content)

  // Code blocks (must be processed first)
  html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (_match, _lang, code) => {
    return `<pre><code>${code}</code></pre>`
  })

  // Inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>')

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')

  // Italic
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>')

  // Headings
  html = html.replace(/^#### (.+)$/gm, '<h4>$1</h4>')
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>')
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>')
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>')

  // Unordered list items
  html = html.replace(/^[-*] (.+)$/gm, '<li>$1</li>')

  // Ordered list items
  html = html.replace(/^\d+\. (.+)$/gm, '<li>$1</li>')

  // Horizontal rule
  html = html.replace(/^---+$/gm, '<hr>')

  // Tables
  html = html.replace(/^\|(.+)\|$/gm, (match) => {
    const cells = match.split('|').filter(c => c.trim() !== '')
    if (cells.every(c => /^[-:]+$/.test(c.trim()))) return ''
    const isHeader = !match.includes('---')
    const tag = isHeader ? 'th' : 'td'
    const row = cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('')
    return `<tr>${row}</tr>`
  })

  // Wrap consecutive <li> in <ul>
  html = html.replace(/((?:<li>.*<\/li>\n?)+)/g, '<ul>$1</ul>')

  // Wrap consecutive <tr> in <table>
  html = html.replace(/((?:<tr>.*<\/tr>\n?)+)/g, '<table>$1</table>')

  // Paragraphs: wrap non-tag lines
  html = html
    .split('\n')
    .map(line => {
      const trimmed = line.trim()
      if (!trimmed) return ''
      if (trimmed.startsWith('<')) return line
      return `<p>${line}</p>`
    })
    .join('\n')

  return html
}

function generateConversationHTML(messages: ExportMessage[], options: ExportOptions = {}): string {
  const title = options.title || 'LINZ 对话记录'
  const date = new Date().toLocaleString('zh-CN')

  const messageHtml = messages.map(msg => {
    if (msg.role === 'user') {
      return `
        <div class="message user">
          <div class="message-label user-label">用户</div>
          <div class="message-content">${renderMarkdownAsHtml(msg.content)}</div>
        </div>`
    } else {
      const agentType = msg.agentType || 'assistant'
      const agentColor = AGENT_COLORS[agentType] || '#666666'
      const agentName = agentType !== 'assistant' ? (AGENT_NAMES[agentType] || agentType) : '助手'
      const showBadge = options.includeAgentBadges !== false && agentType !== 'assistant'

      return `
        <div class="message assistant">
          ${showBadge ? `<div class="agent-badge" style="background-color: ${agentColor}">${agentName}</div>` : ''}
          <div class="message-content">${renderMarkdownAsHtml(msg.content)}</div>
        </div>`
    }
  }).join('')

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Microsoft YaHei', 'SimHei', 'PingFang SC', sans-serif;
      margin: 40px;
      color: #333;
      line-height: 1.6;
    }
    .title {
      text-align: center;
      font-size: 24px;
      font-weight: bold;
      color: #1E6FCC;
      margin-bottom: 8px;
    }
    .date {
      text-align: center;
      color: #999;
      font-size: 14px;
      margin-bottom: 30px;
    }
    .divider {
      border: none;
      border-top: 2px solid #1E6FCC;
      margin-bottom: 24px;
    }
    .message {
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 8px;
      page-break-inside: avoid;
    }
    .user {
      background: #E6F0FF;
      text-align: right;
    }
    .assistant {
      background: #F5F5F7;
      text-align: left;
    }
    .message-label {
      font-size: 12px;
      font-weight: bold;
      margin-bottom: 4px;
    }
    .user-label {
      color: #1E6FCC;
    }
    .agent-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 4px;
      color: white;
      font-size: 12px;
      font-weight: bold;
      margin-bottom: 6px;
    }
    .message-content {
      font-size: 14px;
      color: #333;
    }
    .message-content h1, .message-content h2, .message-content h3, .message-content h4 {
      margin: 12px 0 6px;
      color: #222;
    }
    .message-content h1 { font-size: 20px; }
    .message-content h2 { font-size: 18px; }
    .message-content h3 { font-size: 16px; }
    .message-content h4 { font-size: 15px; }
    .message-content p {
      margin: 4px 0;
    }
    .message-content ul, .message-content ol {
      margin: 4px 0;
      padding-left: 20px;
    }
    .message-content pre {
      background: #282C34;
      color: #ABB2BF;
      padding: 12px;
      border-radius: 4px;
      overflow-x: auto;
      font-family: 'Consolas', 'Courier New', monospace;
      font-size: 13px;
      margin: 8px 0;
      white-space: pre-wrap;
      word-wrap: break-word;
    }
    .message-content code {
      font-family: 'Consolas', 'Courier New', monospace;
      background: #f0f0f0;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 13px;
    }
    .message-content pre code {
      background: none;
      padding: 0;
    }
    .message-content table {
      border-collapse: collapse;
      width: 100%;
      margin: 8px 0;
    }
    .message-content th, .message-content td {
      border: 1px solid #ddd;
      padding: 6px 10px;
      font-size: 13px;
    }
    .message-content th {
      background: #f5f5f5;
      font-weight: bold;
    }
    .message-content hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 12px 0;
    }
    .message-content strong {
      font-weight: bold;
    }
    .message-content em {
      font-style: italic;
    }
  </style>
</head>
<body>
  <div class="title">${escapeHtml(title)}</div>
  <div class="date">${date}</div>
  <hr class="divider">
  ${messageHtml}
</body>
</html>`
}

export async function exportToPDF(
  messages: ExportMessage[],
  options: ExportOptions = {}
): Promise<Buffer> {
  const html = generateConversationHTML(messages, options)

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false,
    webPreferences: {
      offscreen: true
    }
  })

  try {
    await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
    // Wait for rendering to complete
    await new Promise(resolve => setTimeout(resolve, 500))

    const pdfData = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true
    })

    return Buffer.from(pdfData)
  } finally {
    win.close()
  }
}
