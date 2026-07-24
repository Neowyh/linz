import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  TabStopType,
  TabStopPosition,
  BorderStyle,
  Table,
  TableRow,
  TableCell,
  WidthType,
  ShadingType,
  Math as DocxMath
} from 'docx'
import { latexToDocxMath } from './latex-to-omml'

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
  orchestrator: '722ED1',
  aero: '1E6FCC',
  structural: 'FA8C16',
  propulsion: 'CF1322',
  avionics: '08979C',
  simulation: '722ED1',
  documentation: '389E0D',
  retriever: '1890FF'
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

function getAgentColor(agentType: string): string {
  return AGENT_COLORS[agentType] || '666666'
}

function getAgentName(agentType: string): string {
  return AGENT_NAMES[agentType] || agentType
}

function parseMarkdownToDocx(content: string): Paragraph[] {
  const paragraphs: Paragraph[] = []
  const lines = content.split('\n')
  let inCodeBlock = false
  let codeLines: string[] = []
  let codeLang = ''
  let inTable = false
  let tableRows: string[][] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // Code block handling
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLang = line.slice(3).trim()
        codeLines = []
        continue
      } else {
        inCodeBlock = false
        // Add code block as a single paragraph with monospace font
        const codeContent = codeLines.join('\n')
        if (codeContent) {
          paragraphs.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: codeContent,
                  font: 'Consolas',
                  size: 18,
                  color: 'ABB2BF'
                })
              ],
              shading: { type: ShadingType.SOLID, color: '282C34' },
              spacing: { before: 120, after: 120 },
              indent: { left: 360 }
            })
          )
        }
        continue
      }
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Table handling
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim() !== '').map(c => c.trim())
      if (cells.length === 0) continue

      // Check if this is a separator line (---)
      if (cells.every(c => /^[-:]+$/.test(c))) {
        continue
      }

      tableRows.push(cells)
      inTable = true
      continue
    } else if (inTable) {
      // End of table, render it
      if (tableRows.length > 0) {
        paragraphs.push(buildTable(tableRows))
      }
      tableRows = []
      inTable = false
    }

    // Empty line
    if (line.trim() === '') {
      paragraphs.push(new Paragraph({ children: [] }))
      continue
    }

    // Headings
    if (line.startsWith('#### ')) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(line.slice(5)),
          heading: HeadingLevel.HEADING_4,
          spacing: { before: 240, after: 120 }
        })
      )
      continue
    }
    if (line.startsWith('### ')) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(line.slice(4)),
          heading: HeadingLevel.HEADING_3,
          spacing: { before: 240, after: 120 }
        })
      )
      continue
    }
    if (line.startsWith('## ')) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(line.slice(3)),
          heading: HeadingLevel.HEADING_2,
          spacing: { before: 280, after: 120 }
        })
      )
      continue
    }
    if (line.startsWith('# ')) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(line.slice(2)),
          heading: HeadingLevel.HEADING_1,
          spacing: { before: 320, after: 160 }
        })
      )
      continue
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(line.replace(/^[-*]\s/, '')),
          bullet: { level: 0 },
          spacing: { before: 40, after: 40 }
        })
      )
      continue
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      paragraphs.push(
        new Paragraph({
          children: parseInlineFormatting(line.replace(/^\d+\.\s/, '')),
          numbering: { reference: 'ordered-list', level: 0 },
          spacing: { before: 40, after: 40 }
        })
      )
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      paragraphs.push(
        new Paragraph({
          children: [],
          border: {
            bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' }
          },
          spacing: { before: 200, after: 200 }
        })
      )
      continue
    }

    // Regular paragraph
    paragraphs.push(
      new Paragraph({
        children: parseInlineFormatting(line),
        spacing: { before: 40, after: 40 }
      })
    )
  }

  // Handle remaining table
  if (inTable && tableRows.length > 0) {
    paragraphs.push(buildTable(tableRows))
  }

  return paragraphs
}

function parseInlineFormatting(text: string, options?: { color?: string }): (TextRun | DocxMath)[] {
  // 先按 $...$ 切分出行内公式，剩余部分走原有 bold/italic/code 解析
  const result: (TextRun | DocxMath)[] = []
  const regex = /\$([^$\n]+?)\$/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      result.push(...parseInlineFormattingNoMath(text.slice(lastIndex, match.index), options))
    }
    result.push(latexToDocxMath(match[1]))
    lastIndex = regex.lastIndex
  }
  if (lastIndex < text.length) {
    result.push(...parseInlineFormattingNoMath(text.slice(lastIndex), options))
  }
  if (result.length === 0) {
    result.push(new TextRun({ text, color: options?.color }))
  }
  return result
}

// 原有 bold/italic/code 解析（不含数学公式）
function parseInlineFormattingNoMath(text: string, options?: { color?: string }): TextRun[] {
  const color = options?.color
  const runs: TextRun[] = []
  // Match bold (**text** or __text__), italic (*text* or _text_), inline code (`text`)
  const regex = /(\*\*(.+?)\*\*|__(.+?)__)|(\*(.+?)\*|_(.+?)_)|(`(.+?)`)/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      runs.push(new TextRun({ text: text.slice(lastIndex, match.index), color }))
    }

    if (match[2] || match[3]) {
      // Bold
      runs.push(new TextRun({ text: match[2] || match[3], bold: true, color }))
    } else if (match[5] || match[6]) {
      // Italic
      runs.push(new TextRun({ text: match[5] || match[6], italics: true, color }))
    } else if (match[8]) {
      // Inline code（保留代码样式，覆盖颜色）
      runs.push(new TextRun({ text: match[8], font: 'Consolas', size: 18, color: 'C7254E' }))
    }

    lastIndex = match.index + match[0].length
  }

  // Remaining text
  if (lastIndex < text.length) {
    runs.push(new TextRun({ text: text.slice(lastIndex), color }))
  }

  // If no formatting found, return a single TextRun
  if (runs.length === 0) {
    runs.push(new TextRun({ text, color }))
  }

  return runs
}

// 把 LaTeX 显示公式块渲染为居中的 Math 段落
function buildDisplayMathParagraph(latex: string): Paragraph {
  return new Paragraph({
    children: [latexToDocxMath(latex)],
    alignment: AlignmentType.CENTER,
    spacing: { before: 120, after: 120 }
  })
}

// 归一化数学分隔符：\[...\] → $$...$$，\(...\) → $...$
function normalizeMathDelimiters(src: string): string {
  return src
    .replace(/\\\[([\s\S]+?)\\\]/g, (_, m) => `$$${m}$$`)
    .replace(/\\\(([\s\S]+?)\\\)/g, (_, m) => `$${m}$`)
}

function buildTable(rows: string[][]): Paragraph {
  // Convert table to text-based representation for simplicity
  // docx tables need full TableCell/TableRow construction which is complex
  const maxCols = Math.max(...rows.map(r => r.length))
  const tableCells = rows.map(row => {
    const cells = []
    for (let i = 0; i < maxCols; i++) {
      cells.push(
        new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: row[i] || '', size: 18 })] })],
          width: { size: Math.floor(9000 / maxCols), type: WidthType.DXA }
        })
      )
    }
    return new TableRow({ children: cells })
  })

  return new Paragraph({
    children: [
      new TextRun({ text: '' }) // Placeholder; actual table rendered separately
    ]
  })
}

// Build a proper docx Table
function buildDocxTable(rows: string[][]): Table {
  const maxCols = Math.max(...rows.map(r => r.length))
  const tableRows = rows.map((row, rowIdx) => {
    const cells = []
    for (let i = 0; i < maxCols; i++) {
      const isHeader = rowIdx === 0
      cells.push(
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: row[i] || '',
                  bold: isHeader,
                  size: 18
                })
              ]
            })
          ],
          width: { size: Math.floor(9000 / maxCols), type: WidthType.DXA },
          shading: isHeader
            ? { type: ShadingType.SOLID, color: 'F0F0F0' }
            : undefined
        })
      )
    }
    return new TableRow({ children: cells })
  })

  return new Table({
    rows: tableRows,
    width: { size: 9000, type: WidthType.DXA }
  })
}

export async function exportToWord(
  messages: ExportMessage[],
  options: ExportOptions = {}
): Promise<Buffer> {
  const children: (Paragraph | Table)[] = []

  // Title
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: options.title || 'LINZ 对话记录',
          bold: true,
          size: 36,
          color: '1E6FCC'
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 }
    })
  )

  // Date
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: `导出时间: ${new Date().toLocaleString('zh-CN')}`,
          italics: true,
          color: '666666',
          size: 20
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 }
    })
  )

  // Separator
  children.push(
    new Paragraph({
      children: [],
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, color: '1E6FCC' }
      },
      spacing: { after: 300 }
    })
  )

  // Messages
  for (const msg of messages) {
    if (msg.role === 'user') {
      // User message
      children.push(
        new Paragraph({
          children: [
            new TextRun({ text: '用户', bold: true, color: '1E6FCC', size: 22 })
          ],
          alignment: AlignmentType.RIGHT,
          spacing: { before: 240, after: 60 }
        })
      )
      // 用户消息也走 markdown 内联解析（加粗/斜体/行内代码/公式），按行切分并用 break:1 拼接，
      // 保留单一段落的气泡背景与右对齐样式
      const userLines = msg.content.split('\n')
      const userRuns: (TextRun | DocxMath)[] = []
      userLines.forEach((line, idx) => {
        if (idx > 0) userRuns.push(new TextRun({ break: 1 }))
        userRuns.push(...parseInlineFormatting(line, { color: '333333' }))
      })
      children.push(
        new Paragraph({
          children: userRuns,
          alignment: AlignmentType.RIGHT,
          spacing: { after: 120 },
          shading: { type: ShadingType.SOLID, color: 'E6F0FF' },
          indent: { left: 3600 }
        })
      )
    } else {
      // Agent message
      const agentType = msg.agentType || 'assistant'
      const agentColor = getAgentColor(agentType)
      const agentName = agentType !== 'assistant' ? getAgentName(agentType) : '助手'

      // Agent badge
      if (options.includeAgentBadges !== false && agentType !== 'assistant') {
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: `[${agentName}]`,
                bold: true,
                color: agentColor,
                size: 20
              })
            ],
            spacing: { before: 240, after: 60 }
          })
        )
      }

      // Content with markdown parsing
      const contentParagraphs = parseMarkdownToDocxContent(msg.content)
      children.push(...contentParagraphs)
    }
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: 'ordered-list',
          levels: [
            {
              level: 0,
              format: 'decimal' as any,
              text: '%1.',
              alignment: AlignmentType.START,
              style: { paragraph: { indent: { left: 720, hanging: 360 } } }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
          }
        },
        children
      }
    ]
  })

  return await Packer.toBuffer(doc) as unknown as Buffer
}

// Full markdown parsing that also handles tables properly (returns Paragraph | Table)
function parseMarkdownToDocxContent(content: string): (Paragraph | Table)[] {
  const result: (Paragraph | Table)[] = []
  // 先归一化数学分隔符，统一为 $...$ / $$...$$
  const normalized = normalizeMathDelimiters(content)
  const lines = normalized.split('\n')
  let inCodeBlock = false
  let codeLines: string[] = []
  let tableRows: string[][] = []
  let inTable = false
  // 显示公式块状态：跨行 $$ ... $$ 时累积中间内容
  let inMathBlock = false
  let mathBlockBuf: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    // 跨行显示公式块：在 $$ 与 $$ 之间累积
    if (inMathBlock) {
      const closeIdx = line.indexOf('$$')
      if (closeIdx >= 0) {
        // 同行 $$ 后还有内容则忽略（罕见），通常 $$ 独占一行
        mathBlockBuf.push(line.slice(0, closeIdx))
        result.push(buildDisplayMathParagraph(mathBlockBuf.join('\n').trim()))
        mathBlockBuf = []
        inMathBlock = false
      } else {
        mathBlockBuf.push(line)
      }
      continue
    }

    // 单行显示公式块：$$...$$ 整行
    const displayMatch = /^\$\$([\s\S]+?)\$\$$/.exec(line.trim())
    if (displayMatch) {
      result.push(buildDisplayMathParagraph(displayMatch[1].trim()))
      continue
    }
    // 行首 $$ 开启跨行显示公式块
    if (line.trim().startsWith('$$')) {
      const rest = line.trim().slice(2)
      const closeIdx = rest.indexOf('$$')
      if (closeIdx >= 0) {
        // 同行闭合 $$...$$
        result.push(buildDisplayMathParagraph(rest.slice(0, closeIdx).trim()))
      } else {
        inMathBlock = true
        mathBlockBuf = rest ? [rest] : []
      }
      continue
    }

    // Code block
    if (line.startsWith('```')) {
      if (!inCodeBlock) {
        inCodeBlock = true
        codeLines = []
        continue
      } else {
        inCodeBlock = false
        const codeContent = codeLines.join('\n')
        if (codeContent) {
          result.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: codeContent,
                  font: 'Consolas',
                  size: 18,
                  color: 'ABB2BF'
                })
              ],
              shading: { type: ShadingType.SOLID, color: '282C34' },
              spacing: { before: 120, after: 120 },
              indent: { left: 360 }
            })
          )
        }
        continue
      }
    }

    if (inCodeBlock) {
      codeLines.push(line)
      continue
    }

    // Table
    if (line.includes('|') && line.trim().startsWith('|')) {
      const cells = line.split('|').filter(c => c.trim() !== '').map(c => c.trim())
      if (cells.length === 0) continue
      if (cells.every(c => /^[-:]+$/.test(c))) continue

      tableRows.push(cells)
      inTable = true
      continue
    } else if (inTable) {
      if (tableRows.length > 0) {
        result.push(buildDocxTable(tableRows))
      }
      tableRows = []
      inTable = false
    }

    // Empty line
    if (line.trim() === '') {
      result.push(new Paragraph({ children: [] }))
      continue
    }

    // Headings
    if (line.startsWith('#### ')) {
      result.push(new Paragraph({ children: parseInlineFormatting(line.slice(5)), heading: HeadingLevel.HEADING_4, spacing: { before: 240, after: 120 } }))
      continue
    }
    if (line.startsWith('### ')) {
      result.push(new Paragraph({ children: parseInlineFormatting(line.slice(4)), heading: HeadingLevel.HEADING_3, spacing: { before: 240, after: 120 } }))
      continue
    }
    if (line.startsWith('## ')) {
      result.push(new Paragraph({ children: parseInlineFormatting(line.slice(3)), heading: HeadingLevel.HEADING_2, spacing: { before: 280, after: 120 } }))
      continue
    }
    if (line.startsWith('# ')) {
      result.push(new Paragraph({ children: parseInlineFormatting(line.slice(2)), heading: HeadingLevel.HEADING_1, spacing: { before: 320, after: 160 } }))
      continue
    }

    // Unordered list
    if (/^[-*]\s/.test(line)) {
      result.push(new Paragraph({ children: parseInlineFormatting(line.replace(/^[-*]\s/, '')), bullet: { level: 0 }, spacing: { before: 40, after: 40 } }))
      continue
    }

    // Ordered list
    if (/^\d+\.\s/.test(line)) {
      result.push(new Paragraph({ children: parseInlineFormatting(line.replace(/^\d+\.\s/, '')), numbering: { reference: 'ordered-list', level: 0 }, spacing: { before: 40, after: 40 } }))
      continue
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      result.push(new Paragraph({ children: [], border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'CCCCCC' } }, spacing: { before: 200, after: 200 } }))
      continue
    }

    // Regular paragraph
    result.push(new Paragraph({ children: parseInlineFormatting(line), spacing: { before: 40, after: 40 } }))
  }

  // Remaining table
  if (inTable && tableRows.length > 0) {
    result.push(buildDocxTable(tableRows))
  }
  // 未闭合的显示公式块（罕见，容错）
  if (inMathBlock && mathBlockBuf.length > 0) {
    result.push(buildDisplayMathParagraph(mathBlockBuf.join('\n').trim()))
  }

  return result
}
