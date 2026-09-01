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
  toolCall?: unknown
  thinking?: string
  skillTriggers?: SkillTriggerInfo[]
  stepProgress?: StepProgressData
  /** 面板指令（对话→面板联动）：由 Agent 的 ⟪PANEL⟫ 标记解析而来，渲染端 panelCommandStore 路由 */
  panelActions?: PanelCommandPayload[]
}

/** 面板指令 payload：与 src/main/agents/base.agent.ts 的 PanelCommandPayload 保持一致 */
export interface PanelCommandPayload {
  panelType: string
  action: string
  payload: Record<string, unknown>
  sourceMessageId?: string
  instanceId?: string
}

export interface StepProgressData {
  steps: string[]
  doneIndex: number
}

export interface SkillTriggerInfo {
  skillId: string
  skillName: string
  source: 'forced' | 'matched'
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

// 文件管理器（右侧面板"文件"标签）类型
export interface FileEntry {
  name: string
  /** 相对工作空间根目录的路径，统一用 '/' 分隔；根目录为 '' */
  relPath: string
  type: 'dir' | 'file'
  size: number
  mtime: number
}

export type FilePreviewData =
  | { kind: 'text'; content: string; language?: string; truncated?: boolean }
  | { kind: 'html'; html: string; truncated?: boolean }
  | { kind: 'pdf'; url: string; text: string }
  | { kind: 'image'; dataUrl: string }
  | { kind: 'binary'; message: string }
  | { error: string }

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
  tool_calls?: string | null
  skill_triggers?: string | null
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

export interface GraphNode {
  id: string
  kind: 'document' | 'entity'
  label: string
  category?: string
  tags?: string[]
  chunkCount?: number
  entityType?: string
  docIds?: string[]
}

export interface GraphEdge {
  id: string
  source: string
  target: string
  kind: 'similar' | 'relation' | 'mentions'
  weight?: number
  label?: string
}

export interface GraphPayload {
  nodes: GraphNode[]
  edges: GraphEdge[]
  truncated: boolean
  entityCount: number
}

export interface GraphEnrichProgress {
  total: number
  done: number
  fileName: string
  status: 'extracting' | 'done' | 'skipped' | 'error'
  error?: string
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
    getApiKey(): Promise<string>
    setApiKey(key: string): Promise<{ success: boolean }>
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
    graphBuild(options?: { threshold?: number; includeEntities?: boolean }): Promise<GraphPayload>
    graphDocChunks(docId: string, limit?: number): Promise<Array<{ content: string; chunk_index: number }>>
    graphLlmEnrich(docIds: string[]): Promise<{ done: number; skipped: number; failed: number; entityCount: number }>
    graphClearEnrichment(docIds?: string[]): Promise<{ success: boolean }>
    graphAsk(question: string, docIds: string[]): Promise<{ answer: string; sources: Array<{ file_name: string; snippet: string }> }>
    onGraphEnrichProgress(callback: (data: GraphEnrichProgress) => void): () => void
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
    getFolder(): Promise<{ folder: string }>
    setFolder(folder: string): Promise<{ success: boolean; error?: string }>
    onChanged(callback: (id: string) => void): () => void
  }
  files: {
    getRoot(): Promise<{ root: string | null }>
    list(relPath?: string): Promise<{ entries: FileEntry[] } | { error: string }>
    read(relPath: string): Promise<FilePreviewData>
    readBinary(relPath: string): Promise<{ data: string; size: number; error?: never } | { error: string }>
    openExternal(relPath: string): Promise<{ success: boolean; error?: string }>
    reveal(relPath: string): Promise<{ success: boolean; error?: string }>
  }
  step: {
    readMesh(relPath: string): Promise<
      | { success: true; positions: number[]; indices: number[]; meshCount: number; vertexCount: number }
      | { success: false; error: string }
    >
  }
  browser: {
    onOpenInNewTab(callback: (data: { url: string; guestId: number }) => void): () => void
    onOpenPanel(callback: () => void): () => void
    reportActiveTab(guestId: number | null): void
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
  approval: {
    onRequest(callback: (data: {
      requestId: string
      messageId?: string
      toolName: string
      risk: string
      argsSummary: string
      agentType: string
      agentName: string
      agentColor: string
      timestamp: number
    }) => void): () => void
    respond(requestId: string, decision: 'approve' | 'deny', remember: boolean): Promise<boolean>
  }
  security: {
    listRisks(): Promise<Record<string, string>>
    getMode(): Promise<'default' | 'full'>
    setMode(mode: 'default' | 'full'): Promise<{ success: boolean; error?: string }>
    listPolicies(): Promise<Record<string, 'allow' | 'ask' | 'deny'>>
    setPolicy(toolName: string, action: 'allow' | 'ask' | 'deny' | null): Promise<{ success: boolean; error?: string }>
    listRemembered(): Promise<Array<{ fingerprint: string; toolName: string; argsSummary: string; ts: number }>>
    forgetRemembered(fingerprint: string): Promise<{ success: boolean; error?: string }>
    listAudit(limit?: number): Promise<any[]>
    clearAudit(): Promise<{ success: boolean }>
    listProtected(): Promise<string[]>
    addProtected(p: string): Promise<{ success: boolean; error?: string }>
    removeProtected(p: string): Promise<{ success: boolean }>
    pickProtectedDirectory(): Promise<string | null>
  }
  menu: {
    onAction(callback: (data: { action: string; payload?: unknown }) => void): () => void
  }
  dsh: {
    getPort(): Promise<number>
    getConfig(): Promise<{ port: number; preloadPath: string }>
    listPlugins(): Promise<Array<{ name: string; version: string; packageDir: string }>>
    installPlugin(packageDir: string): Promise<{ success: boolean; name?: string; error?: string }>
    onOpenSessionRequest(callback: (sessionId: string) => void): () => void
  }
}

declare global {
  interface Window {
    aeromind: AeromindAPI
  }
}
