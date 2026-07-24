export type ExportFormat = 'markdown' | 'word' | 'pdf'

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

export interface ExportResult {
  filePath: string
  fileName: string
}

export { exportToWord } from './word.exporter'
export { exportToPDF } from './pdf.exporter'
