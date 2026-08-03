export type AgentState = 'idle' | 'thinking' | 'working' | 'waiting' | 'completed' | 'error'

export interface AgentStatusData {
  agentType: string
  name: string
  color: string
  state: AgentState
  currentTask?: string
}

export interface StreamChunkData {
  conversationId: string
  messageId: string
  agentType: string
  chunk: string
}

export interface StreamEndData {
  conversationId: string
}

export interface StreamErrorData {
  conversationId: string
  error: string
}

// 技能导入候选（与 main/agents/skill-import.service.ts 的 SkillCandidate 对应）
export interface SkillImportCandidateData {
  sourcePath: string
  name: string
  description: string
  content: string
  suggestedKeywords: string[]
  warnings: string[]
  duplicate: boolean
  packageSource?: { kind: 'dir'; dir: string } | { kind: 'zip'; zipPath: string; prefix: string }
  scriptNames: string[]
}

export interface ConversationSummary {
  id: string
  title: string | null
  created_at: string
  updated_at: string
  task_type: string | null
  agents_used: string
  total_tokens: number
  status: string
}

export interface ConversationDetail extends ConversationSummary {
  messages: MessageData[]
}

export interface MessageData {
  id: string
  conversation_id: string
  role: string
  agent_type: string | null
  content: string
  tokens: number
  created_at: string
}

export interface AutoTaskNotification {
  title: string
  body: string
}

export interface KbDocument {
  id: string
  file_path: string
  file_name: string
  file_type: string
  domain_category: string
  tags: string[]
  index_status: string
  chunk_count: number
  file_size: number
  added_at: string
  indexed_at: string | null
}

export interface KbStats {
  totalDocuments: number
  totalChunks: number
  categories: Array<{ category: string; count: number }>
  dbSizeBytes?: number
}

export interface KbImportProgress {
  total: number
  done: number
  current?: string
  fileName: string
  status: 'parsing' | 'indexing' | 'done' | 'skipped' | 'error'
  error?: string
  chunkCount?: number
}

export interface KbImportFileResult {
  fileName: string
  status: 'done' | 'skipped' | 'error'
  error?: string
  chunkCount?: number
  docId?: string
}

export interface TableColumnMeta {
  name: string
  type: 'INTEGER' | 'REAL' | 'TEXT'
}

export interface TableMeta {
  id: string
  dataset_id: string
  table_name: string
  sheet_name: string | null
  columns: TableColumnMeta[]
  row_count: number
}

export interface TableDataset {
  id: string
  name: string
  source_file: string
  file_type: string
  table_count: number
  total_rows: number
  created_at: string
  tables: TableMeta[]
}

export interface TableImportResult {
  fileName: string
  status: 'done' | 'error'
  error?: string
  datasetId?: string
  datasetName?: string
  tableCount?: number
  totalRows?: number
}

export interface TableQueryPayload {
  success: boolean
  error?: string
  columns: string[]
  rows: Array<Record<string, unknown>>
  truncated: boolean
}

export interface KbImportSummary {
  total: number
  done: number
  skipped: number
  error: number
  results: KbImportFileResult[]
}

export interface TemplateData {
  id: string
  name: string
  category: string
  description: string
  prompt_template: string
  agents: string
  input_params: string
  output_format: string
  is_builtin: number
  is_custom: number
  usage_count: number
  rating: number
  created_at: string
}

export interface ParsedAttachment {
  fileName: string
  fileType: 'pdf' | 'docx' | 'xlsx' | 'csv' | 'dat' | 'txt' | 'png' | 'jpg' | 'unknown'
  content: string
  metadata?: {
    pages?: number
    sheets?: string[]
    rows?: number
    confidence?: number
  }
  error?: string
}

export interface WorkspaceData {
  id: string
  name: string
  path: string
  createdAt: string
  lastOpenedAt: string
}

export interface CustomAgentData {
  id: string
  name: string
  description: string | null
  color: string
  icon: string
  system_prompt: string
  tools: string          // JSON array
  keywords: string       // JSON array
  delegates_to: string   // JSON array of agent types
  subtask_prefix: string | null
  model_name: string
  is_custom: number
  usage_count: number
  created_at: string
  updated_at: string
  engine: 'deepseek' | 'pi'
  kb_tags: string        // JSON array：知识库限定标签
}

export interface ToolInfo {
  name: string
  description: string
}

export interface AgentSkillData {
  id: string
  name: string
  description: string | null
  content: string
  target_agents: string[]      // empty = all agents
  trigger_keywords: string[]   // empty = always-on
  priority: number
  enabled: boolean
  is_builtin: boolean
  is_custom: boolean
  created_at: string
  updated_at: string
  package_path?: string | null
}

export interface AeromindAPI {
  chat: {
    sendMessage(conversationId: string, content: string, selectedAgent?: string, dispatchMode?: 'single' | 'collaborative', skillIds?: string[]): void
    onStreamChunk(callback: (data: StreamChunkData) => void): () => void
    onStreamEnd(callback: (data: StreamEndData) => void): () => void
    onStreamError(callback: (data: StreamErrorData) => void): () => void
    abort(): void
    uploadAttachment(filePath: string): Promise<ParsedAttachment>
  }
  agent: {
    onStatusUpdate(callback: (data: AgentStatusData) => void): () => void
    onMessage(callback: (data: any) => void): () => void
    listStates(): Promise<AgentStatusData[]>
    availableTools(): Promise<ToolInfo[]>
  }
  customAgent: {
    list(): Promise<CustomAgentData[]>
    get(id: string): Promise<CustomAgentData | null>
    create(params: Record<string, unknown>): Promise<{ success: boolean; agent?: CustomAgentData; error?: string }>
    update(id: string, updates: Record<string, unknown>): Promise<{ success: boolean; error?: string }>
    delete(id: string): Promise<{ success: boolean; error?: string }>
    listBuiltin(): Promise<CustomAgentData[]>
    getBuiltin(id: string): Promise<CustomAgentData | null>
    updateBuiltin(id: string, updates: Record<string, unknown>): Promise<{ success: boolean; error?: string }>
    resetBuiltin(id: string): Promise<{ success: boolean; error?: string }>
  }
  agentSkill: {
    list(): Promise<AgentSkillData[]>
    get(id: string): Promise<AgentSkillData | null>
    create(params: {
      name: string; description?: string; content: string;
      targetAgents?: string[]; triggerKeywords?: string[];
      priority?: number; enabled?: boolean
    }): Promise<{ success: boolean; skill?: AgentSkillData; error?: string }>
    update(id: string, updates: Record<string, unknown>): Promise<{ success: boolean; error?: string }>
    delete(id: string): Promise<{ success: boolean; error?: string }>
    toggle(id: string, enabled: boolean): Promise<{ success: boolean; error?: string }>
    importPick(): Promise<string[]>
    importPickFolder(): Promise<string[]>
    importParse(paths: string[]): Promise<{ candidates: SkillImportCandidateData[]; errors: string[] }>
    importConfirm(items: Array<{ name: string; description?: string; content: string; triggerKeywords?: string[]; packageSource?: { kind: 'dir'; dir: string } | { kind: 'zip'; zipPath: string; prefix: string } }>): Promise<{ success: boolean; imported: number; names: string[]; error?: string }>
    exportSkill(id: string): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }>
  }
  conversation: {
    list(): Promise<ConversationSummary[]>
    get(id: string): Promise<ConversationDetail | null>
    create(title?: string): Promise<ConversationSummary>
    delete(id: string): Promise<{ success: boolean }>
    rename(id: string, title: string): Promise<{ success: boolean }>
  }
  settings: {
    get(key: string): Promise<any>
    set(key: string, value: any): Promise<{ success: boolean }>
  }
  autoTask: {
    list(): Promise<any[]>
    create(task: { name: string; description?: string; cron_expression: string; agents?: string; result_action?: string }): Promise<any>
    update(id: string, updates: any): Promise<{ success: boolean }>
    delete(id: string): Promise<{ success: boolean }>
    toggle(id: string): Promise<{ success: boolean }>
    test(id: string): Promise<{ success: boolean; message?: string }>
    onNotification(callback: (data: AutoTaskNotification) => void): () => void
  }
  template: {
    list(category?: string): Promise<TemplateData[]>
    get(id: string): Promise<TemplateData | null>
    use(id: string): Promise<TemplateData>
    categories(): Promise<string[]>
    create(params: { name: string; description?: string; category: string; promptTemplate: string; agentType?: string[] }): Promise<TemplateData | null>
    update(id: string, updates: { name?: string; description?: string; category?: string; promptTemplate?: string; agentType?: string[] }): Promise<{ success: boolean; error?: string }>
    delete(id: string): Promise<{ success: boolean; error?: string }>
  }
  kb: {
    listDocuments(): Promise<KbDocument[]>
    uploadDocuments(): Promise<any[]>
    pickImportPaths(): Promise<string[]>
    importPaths(paths: string[], tags?: string[], domain?: string): Promise<KbImportSummary>
    importStatus(): Promise<{ running: boolean }>
    onImportProgress(callback: (data: KbImportProgress) => void): () => void
    updateTags(docId: string, tags: string[]): Promise<{ success: boolean }>
    updateDomain(docId: string, domain: string): Promise<{ success: boolean }>
    tags(): Promise<string[]>
    search(query: string, limit?: number, tags?: string[]): Promise<Array<{ content: string; document_id: string; file_name: string; score: number }>>
    deleteDocument(id: string): Promise<{ success: boolean }>
    deleteDocuments(ids: string[]): Promise<{ success: boolean; deleted: number }>
    stats(): Promise<KbStats>
    categories(): Promise<string[]>
    listByCategory(category: string): Promise<KbDocument[]>
    ask(question: string, tags?: string[]): Promise<{ answer: string; sources: Array<{ file_name: string; snippet: string }> }>
    semanticSearch(query: string, options?: { domain?: string; limit?: number; tags?: string[] }): Promise<Array<{ content: string; document_id: string; file_name: string; score: number }>>
    embeddingStatus(): Promise<boolean>
    generateEmbeddings(): Promise<{ success: boolean; embedded?: number; error?: string }>
  }
  tables: {
    list(): Promise<TableDataset[]>
    import(): Promise<TableImportResult[]>
    preview(tableName: string, limit?: number): Promise<TableQueryPayload>
    remove(datasetId: string): Promise<{ success: boolean; error?: string }>
    query(sql: string): Promise<TableQueryPayload>
  }
  token: {
    getUsage(): Promise<{ inputTokens: number; outputTokens: number }>
    getBudget(): Promise<{
      monthlyLimit: number
      warningThreshold: number
      enabled: boolean
      currentUsage: { inputTokens: number; outputTokens: number }
      percentage: number
    }>
  }
  export: {
    saveDialog(options: { format: string; defaultPath?: string }): Promise<string | null>
    word(messages: Array<{ id: string; role: string; agentType?: string; content: string; createdAt?: string }>, options?: { includeMetadata?: boolean; includeAgentBadges?: boolean; title?: string }): Promise<string>
    pdf(messages: Array<{ id: string; role: string; agentType?: string; content: string; createdAt?: string }>, options?: { includeMetadata?: boolean; includeAgentBadges?: boolean; title?: string }): Promise<string>
    saveFile(filePath: string, dataBase64: string): Promise<{ success: boolean; filePath: string }>
    saveDirectory(): Promise<string | null>
    saveMarkdownBundle(payload: {
      dirPath: string
      fileName: string
      mdContent: string
      images: Array<{ name: string; base64: string }>
    }): Promise<{ success: boolean; mdPath: string }>
  }
  ollama: {
    check(): Promise<boolean>
    status(): Promise<{ provider: string; modelName: string; label: string }>
    save(config: { baseURL?: string; modelName?: string; enabled?: boolean }): Promise<{ success: boolean }>
  }
  fileWorkspace: {
    pickFolder(): Promise<string | null>
  }
  workspace: {
    list(): Promise<WorkspaceData[]>
    current(): Promise<WorkspaceData | null>
    switch(id: string): Promise<{ success: boolean; dbPath: string }>
    create(name: string): Promise<WorkspaceData>
    delete(id: string): Promise<{ success: boolean; error?: string }>
    rename(id: string, name: string): Promise<{ success: boolean }>
    onChanged(callback: (id: string) => void): () => void
  }
  browser: {
    onOpenInNewTab(callback: (data: { url: string; guestId: number }) => void): () => void
  }
  terminal: {
    spawn(opts?: { cwd?: string }): Promise<{ sessionId: string }>
    write(sessionId: string, data: string): void
    resize(sessionId: string, cols: number, rows: number): void
    kill(sessionId: string): void
    onData(callback: (data: { sessionId: string; data: string }) => void): () => void
    onExit(callback: (data: { sessionId: string; exitCode: number }) => void): () => void
  }
  mcp: {
    list(): Promise<any[]>
    get(id: string): Promise<any>
    create(params: any): Promise<{ success: boolean; server?: any; error?: string }>
    update(id: string, updates: any): Promise<{ success: boolean; server?: any; error?: string }>
    delete(id: string): Promise<{ success: boolean; error?: string }>
    testConnection(config: any): Promise<{ success: boolean; toolCount: number; tools: any[]; error?: string }>
    connect(id: string): Promise<{ success: boolean; toolCount?: number; error?: string }>
    disconnect(id: string): Promise<{ success: boolean; error?: string }>
    listTools(id: string): Promise<Array<{ name: string; description: string }>>
    listTemplates(): Promise<any[]>
    detectPython(): Promise<{ path: string | null }>
    detectCatiaServer(): Promise<{ path: string | null; valid: boolean }>
    detectAbaqusServer(): Promise<{ path: string | null; valid: boolean }>
  }
  menu: {
    onAction(callback: (data: { action: string; payload?: unknown }) => void): () => void
  }
}

declare global {
  interface Window {
    aeromind: AeromindAPI
  }
}
