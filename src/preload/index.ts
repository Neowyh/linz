import { contextBridge, ipcRenderer } from 'electron'

const api = {
  chat: {
    sendMessage: (conversationId: string, content: string, selectedAgent?: string, dispatchMode?: 'single' | 'collaborative', skillIds?: string[]): void => {
      ipcRenderer.send('chat:sendMessage', { conversationId, content, selectedAgent, dispatchMode, skillIds })
    },
    onStreamChunk: (callback: (data: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('chat:streamChunk', handler)
      return () => {
        ipcRenderer.removeListener('chat:streamChunk', handler)
      }
    },
    onStreamEnd: (callback: (data: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('chat:streamEnd', handler)
      return () => {
        ipcRenderer.removeListener('chat:streamEnd', handler)
      }
    },
    onStreamError: (callback: (data: { error: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { error: string }): void => {
        callback(data)
      }
      ipcRenderer.on('chat:streamError', handler)
      return () => {
        ipcRenderer.removeListener('chat:streamError', handler)
      }
    },
    abort: (): void => {
      ipcRenderer.send('chat:abort')
    },
    uploadAttachment: (filePath: string): Promise<any> => {
      return ipcRenderer.invoke('chat:uploadAttachment', filePath)
    }
  },

  agent: {
    onStatusUpdate: (callback: (data: any) => void): (() => void) => {      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('agent:statusUpdate', handler)
      return () => {
        ipcRenderer.removeListener('agent:statusUpdate', handler)
      }
    },
    onMessage: (callback: (data: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('agent:message', handler)
      return () => {
        ipcRenderer.removeListener('agent:message', handler)
      }
    },
    listStates: (): Promise<any[]> => {
      return ipcRenderer.invoke('agent:listStates')
    },
    availableTools: (): Promise<Array<{ name: string; description: string }>> => {
      return ipcRenderer.invoke('agent:availableTools')
    }
  },

  customAgent: {
    list: (): Promise<any[]> => {
      return ipcRenderer.invoke('agent:listCustom')
    },
    get: (id: string): Promise<any> => {
      return ipcRenderer.invoke('agent:getCustom', id)
    },
    create: (params: any): Promise<{ success: boolean; agent?: any; error?: string }> => {
      return ipcRenderer.invoke('agent:createCustom', params)
    },
    update: (id: string, updates: any): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent:updateCustom', id, updates)
    },
    delete: (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent:deleteCustom', id)
    },
    listBuiltin: (): Promise<any[]> => {
      return ipcRenderer.invoke('agent:listBuiltin')
    },
    getBuiltin: (id: string): Promise<any> => {
      return ipcRenderer.invoke('agent:getBuiltin', id)
    },
    updateBuiltin: (id: string, updates: any): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent:updateBuiltin', id, updates)
    },
    resetBuiltin: (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent:resetBuiltin', id)
    },
    exportAgent: (id: string): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent:exportAgent', id)
    },
    importPick: (): Promise<string[]> => {
      return ipcRenderer.invoke('agent:importPick')
    },
    importParse: (paths: string[]): Promise<{ candidates: any[]; errors: string[] }> => {
      return ipcRenderer.invoke('agent:importParse', paths)
    },
    importConfirm: (items: any[]): Promise<{ success: boolean; imported: number; names: string[]; errors?: string[] }> => {
      return ipcRenderer.invoke('agent:importConfirm', items)
    }
  },

  agentSkill: {
    list: (): Promise<any[]> => {
      return ipcRenderer.invoke('agent-skill:list')
    },
    get: (id: string): Promise<any> => {
      return ipcRenderer.invoke('agent-skill:get', id)
    },
    create: (params: any): Promise<{ success: boolean; skill?: any; error?: string }> => {
      return ipcRenderer.invoke('agent-skill:create', params)
    },
    update: (id: string, updates: any): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent-skill:update', id, updates)
    },
    delete: (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent-skill:delete', id)
    },
    toggle: (id: string, enabled: boolean): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent-skill:toggle', id, enabled)
    },
    importPick: (): Promise<string[]> => {
      return ipcRenderer.invoke('agent-skill:importPick')
    },
    importPickFolder: (): Promise<string[]> => {
      return ipcRenderer.invoke('agent-skill:importPickFolder')
    },
    importParse: (paths: string[]): Promise<{ candidates: any[]; errors: string[] }> => {
      return ipcRenderer.invoke('agent-skill:importParse', paths)
    },
    importConfirm: (items: any[]): Promise<{ success: boolean; imported: number; names: string[]; error?: string }> => {
      return ipcRenderer.invoke('agent-skill:importConfirm', items)
    },
    exportSkill: (id: string): Promise<{ success: boolean; filePath?: string; canceled?: boolean; error?: string }> => {
      return ipcRenderer.invoke('agent-skill:export', id)
    }
  },

  conversation: {
    list: (): Promise<any[]> => {
      return ipcRenderer.invoke('conversation:list')
    },
    get: (id: string): Promise<any> => {
      return ipcRenderer.invoke('conversation:get', id)
    },
    create: (title?: string): Promise<any> => {
      return ipcRenderer.invoke('conversation:create', title)
    },
    delete: (id: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('conversation:delete', id)
    },
    rename: (id: string, title: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('conversation:rename', id, title)
    }
  },

  settings: {
    get: (key: string): Promise<any> => {
      return ipcRenderer.invoke('settings:get', key)
    },
    set: (key: string, value: any): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('settings:set', key, value)
    },
    getApiKey: (): Promise<string> => {
      return ipcRenderer.invoke('settings:getApiKey')
    },
    setApiKey: (key: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('settings:setApiKey', key)
    }
  },

  autoTask: {
    list: (): Promise<any[]> => {
      return ipcRenderer.invoke('autoTask:list')
    },
    create: (task: { name: string; description?: string; cron_expression: string; agents?: string; result_action?: string }): Promise<any> => {
      return ipcRenderer.invoke('autoTask:create', task)
    },
    update: (id: string, updates: any): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('autoTask:update', id, updates)
    },
    delete: (id: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('autoTask:delete', id)
    },
    toggle: (id: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('autoTask:toggle', id)
    },
    test: (id: string): Promise<{ success: boolean; message?: string }> => {
      return ipcRenderer.invoke('autoTask:test', id)
    },
    onNotification: (callback: (data: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('autoTask:notification', handler)
      return () => {
        ipcRenderer.removeListener('autoTask:notification', handler)
      }
    }
  },

  template: {
    list: (category?: string): Promise<any[]> => {
      return ipcRenderer.invoke('template:list', category)
    },
    get: (id: string): Promise<any> => {
      return ipcRenderer.invoke('template:get', id)
    },
    use: (id: string): Promise<any> => {
      return ipcRenderer.invoke('template:use', id)
    },
    categories: (): Promise<string[]> => {
      return ipcRenderer.invoke('template:categories')
    },
    create: (params: { name: string; description?: string; category: string; promptTemplate: string; agentType?: string[] }): Promise<any> => {
      return ipcRenderer.invoke('template:create', params)
    },
    update: (id: string, updates: { name?: string; description?: string; category?: string; promptTemplate?: string; agentType?: string[] }): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('template:update', id, updates)
    },
    delete: (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('template:delete', id)
    }
  },

  kb: {
    listDocuments: (): Promise<any[]> => {
      return ipcRenderer.invoke('kb:listDocuments')
    },
    uploadDocuments: (): Promise<any[]> => {
      return ipcRenderer.invoke('kb:uploadDocuments')
    },
    pickImportPaths: (): Promise<string[]> => {
      return ipcRenderer.invoke('kb:pickImportPaths')
    },
    importPaths: (paths: string[], tags?: string[], domain?: string): Promise<any> => {
      return ipcRenderer.invoke('kb:importPaths', paths, tags, domain)
    },
    importStatus: (): Promise<{ running: boolean }> => {
      return ipcRenderer.invoke('kb:importStatus')
    },
    onImportProgress: (callback: (data: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('kb:importProgress', handler)
      return () => {
        ipcRenderer.removeListener('kb:importProgress', handler)
      }
    },
    updateTags: (docId: string, tags: string[]): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('kb:updateTags', docId, tags)
    },
    updateDomain: (docId: string, domain: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('kb:updateDomain', docId, domain)
    },
    tags: (): Promise<string[]> => {
      return ipcRenderer.invoke('kb:tags')
    },
    search: (query: string, limit?: number, tags?: string[]): Promise<any[]> => {
      return ipcRenderer.invoke('kb:search', query, limit, tags)
    },
    deleteDocument: (id: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('kb:deleteDocument', id)
    },
    deleteDocuments: (ids: string[]): Promise<{ success: boolean; deleted: number }> => {
      return ipcRenderer.invoke('kb:deleteDocuments', ids)
    },
    stats: (): Promise<any> => {
      return ipcRenderer.invoke('kb:stats')
    },
    categories: (): Promise<string[]> => {
      return ipcRenderer.invoke('kb:categories')
    },
    listByCategory: (category: string): Promise<any[]> => {
      return ipcRenderer.invoke('kb:listByCategory', category)
    },
    ask: (question: string, tags?: string[]): Promise<any> => {
      return ipcRenderer.invoke('kb:ask', question, tags)
    },
    semanticSearch: (query: string, options?: { domain?: string; limit?: number; tags?: string[] }): Promise<any[]> => {
      return ipcRenderer.invoke('kb:semanticSearch', query, options)
    },
    embeddingStatus: (): Promise<boolean> => {
      return ipcRenderer.invoke('kb:embeddingStatus')
    },
    generateEmbeddings: (): Promise<{ success: boolean; embedded?: number; error?: string }> => {
      return ipcRenderer.invoke('kb:generateEmbeddings')
    },
    graphBuild: (options?: { threshold?: number; includeEntities?: boolean }): Promise<any> => {
      return ipcRenderer.invoke('kb:graph:build', options)
    },
    graphDocChunks: (docId: string, limit?: number): Promise<Array<{ content: string; chunk_index: number }>> => {
      return ipcRenderer.invoke('kb:graph:docChunks', docId, limit)
    },
    graphLlmEnrich: (docIds: string[]): Promise<{ done: number; skipped: number; failed: number; entityCount: number }> => {
      return ipcRenderer.invoke('kb:graph:llmEnrich', docIds)
    },
    graphClearEnrichment: (docIds?: string[]): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('kb:graph:clearEnrichment', docIds)
    },
    graphAsk: (question: string, docIds: string[]): Promise<{ answer: string; sources: Array<{ file_name: string; snippet: string }> }> => {
      return ipcRenderer.invoke('kb:graph:ask', question, docIds)
    },
    onGraphEnrichProgress: (callback: (data: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('kb:graph:enrichProgress', handler)
      return () => {
        ipcRenderer.removeListener('kb:graph:enrichProgress', handler)
      }
    }
  },

  tables: {
    list: (): Promise<any[]> => {
      return ipcRenderer.invoke('tables:list')
    },
    import: (): Promise<any[]> => {
      return ipcRenderer.invoke('tables:import')
    },
    preview: (tableName: string, limit?: number): Promise<any> => {
      return ipcRenderer.invoke('tables:preview', tableName, limit)
    },
    remove: (datasetId: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('tables:remove', datasetId)
    },
    query: (sql: string): Promise<any> => {
      return ipcRenderer.invoke('tables:query', sql)
    }
  },

  token: {
    getUsage: (): Promise<{ inputTokens: number; outputTokens: number }> => {
      return ipcRenderer.invoke('token:getUsage')
    },
    getBudget: (): Promise<{
      monthlyLimit: number
      warningThreshold: number
      enabled: boolean
      currentUsage: { inputTokens: number; outputTokens: number }
      percentage: number
    }> => {
      return ipcRenderer.invoke('token:getBudget')
    }
  },

  export: {
    saveDialog: (options: { format: string; defaultPath?: string }): Promise<string | null> => {
      return ipcRenderer.invoke('export:saveDialog', options)
    },
    word: (messages: any[], options?: any): Promise<string> => {
      return ipcRenderer.invoke('export:word', messages, options)
    },
    pdf: (messages: any[], options?: any): Promise<string> => {
      return ipcRenderer.invoke('export:pdf', messages, options)
    },
    saveFile: (filePath: string, dataBase64: string): Promise<{ success: boolean; filePath: string }> => {
      return ipcRenderer.invoke('export:saveFile', filePath, dataBase64)
    },
    saveDirectory: (): Promise<string | null> => {
      return ipcRenderer.invoke('export:saveDirectory')
    },
    saveMarkdownBundle: (payload: {
      dirPath: string
      fileName: string
      mdContent: string
      images: Array<{ name: string; base64: string }>
    }): Promise<{ success: boolean; mdPath: string }> => {
      return ipcRenderer.invoke('export:saveMarkdownBundle', payload)
    }
  },

  ollama: {
    check: (): Promise<boolean> => {
      return ipcRenderer.invoke('ollama:check')
    },
    status: (): Promise<{ provider: string; modelName: string; label: string }> => {
      return ipcRenderer.invoke('ollama:status')
    },
    save: (config: { baseURL?: string; modelName?: string; enabled?: boolean }): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('ollama:save', config)
    }
  },

  fileWorkspace: {
    pickFolder: (): Promise<string | null> => {
      return ipcRenderer.invoke('fileWorkspace:pickFolder')
    }
  },

  workspace: {
    list: (): Promise<any[]> => {
      return ipcRenderer.invoke('workspace:list')
    },
    current: (): Promise<any> => {
      return ipcRenderer.invoke('workspace:current')
    },
    switch: (id: string): Promise<{ success: boolean; dbPath: string }> => {
      return ipcRenderer.invoke('workspace:switch', id)
    },
    create: (name: string): Promise<any> => {
      return ipcRenderer.invoke('workspace:create', name)
    },
    delete: (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('workspace:delete', id)
    },
    rename: (id: string, name: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('workspace:rename', id, name)
    },
    getFolder: (): Promise<{ folder: string }> => {
      return ipcRenderer.invoke('workspace:getFolder')
    },
    setFolder: (folder: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('workspace:setFolder', folder)
    },
    onChanged: (callback: (id: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, id: string): void => {
        callback(id)
      }
      ipcRenderer.on('workspace:changed', handler)
      return () => {
        ipcRenderer.removeListener('workspace:changed', handler)
      }
    }
  },

  files: {
    getRoot: (): Promise<{ root: string | null }> => {
      return ipcRenderer.invoke('fileBrowser:getRoot')
    },
    list: (relPath?: string): Promise<{ entries: any[] } | { error: string }> => {
      return ipcRenderer.invoke('fileBrowser:list', relPath)
    },
    read: (relPath: string): Promise<any> => {
      return ipcRenderer.invoke('fileBrowser:read', relPath)
    },
    readBinary: (relPath: string): Promise<{ data: string; size: number } | { error: string }> => {
      return ipcRenderer.invoke('fileBrowser:readBinary', relPath)
    },
    openExternal: (relPath: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('fileBrowser:openExternal', relPath)
    },
    reveal: (relPath: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('fileBrowser:reveal', relPath)
    }
  },

  step: {
    readMesh: (relPath: string): Promise<any> => {
      return ipcRenderer.invoke('step:readMesh', relPath)
    }
  },

  mcp: {
    list: (): Promise<any[]> => {
      return ipcRenderer.invoke('mcp:list')
    },
    get: (id: string): Promise<any> => {
      return ipcRenderer.invoke('mcp:get', id)
    },
    create: (params: any): Promise<{ success: boolean; server?: any; error?: string }> => {
      return ipcRenderer.invoke('mcp:create', params)
    },
    update: (id: string, updates: any): Promise<{ success: boolean; server?: any; error?: string }> => {
      return ipcRenderer.invoke('mcp:update', id, updates)
    },
    delete: (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('mcp:delete', id)
    },
    testConnection: (config: any): Promise<{ success: boolean; toolCount: number; tools: any[]; error?: string }> => {
      return ipcRenderer.invoke('mcp:testConnection', config)
    },
    connect: (id: string): Promise<{ success: boolean; toolCount?: number; error?: string }> => {
      return ipcRenderer.invoke('mcp:connect', id)
    },
    disconnect: (id: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('mcp:disconnect', id)
    },
    listTools: (id: string): Promise<Array<{ name: string; description: string }>> => {
      return ipcRenderer.invoke('mcp:listTools', id)
    },
    listTemplates: (): Promise<any[]> => {
      return ipcRenderer.invoke('mcp:listTemplates')
    },
    detectPython: (): Promise<{ path: string | null }> => {
      return ipcRenderer.invoke('mcp:detectPython')
    },
    detectCatiaServer: (): Promise<{ path: string | null; valid: boolean }> => {
      return ipcRenderer.invoke('mcp:detectCatiaServer')
    },
    detectAbaqusServer: (): Promise<{ path: string | null; valid: boolean }> => {
      return ipcRenderer.invoke('mcp:detectAbaqusServer')
    }
  },

  browser: {
    onOpenInNewTab: (callback: (data: { url: string; guestId: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { url: string; guestId: number }): void => {
        callback(data)
      }
      ipcRenderer.on('browser:openInNewTab', handler)
      return () => {
        ipcRenderer.removeListener('browser:openInNewTab', handler)
      }
    },
    // 主进程 browser 工具请求打开/聚焦浏览器面板（App.tsx 常驻监听）
    onOpenPanel: (callback: () => void): (() => void) => {
      const handler = (): void => callback()
      ipcRenderer.on('browser:openPanel', handler)
      return () => {
        ipcRenderer.removeListener('browser:openPanel', handler)
      }
    },
    // BrowserPanel 上报当前激活页签的 guestId（供主进程 browser 工具定位 webview）
    reportActiveTab: (guestId: number | null): void => {
      ipcRenderer.send('browser:activeTab', guestId)
    }
  },

  terminal: {
    spawn: (opts: { cwd?: string } = {}): Promise<{ sessionId: string }> => {
      return ipcRenderer.invoke('terminal:spawn', opts)
    },
    write: (sessionId: string, data: string): void => {
      ipcRenderer.send('terminal:write', { sessionId, data })
    },
    resize: (sessionId: string, cols: number, rows: number): void => {
      ipcRenderer.send('terminal:resize', { sessionId, cols, rows })
    },
    kill: (sessionId: string): void => {
      ipcRenderer.send('terminal:kill', { sessionId })
    },
    onData: (callback: (data: { sessionId: string; data: string }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; data: string }): void => {
        callback(data)
      }
      ipcRenderer.on('terminal:data', handler)
      return () => {
        ipcRenderer.removeListener('terminal:data', handler)
      }
    },
    onExit: (callback: (data: { sessionId: string; exitCode: number }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { sessionId: string; exitCode: number }): void => {
        callback(data)
      }
      ipcRenderer.on('terminal:exit', handler)
      return () => {
        ipcRenderer.removeListener('terminal:exit', handler)
      }
    }
  },

  approval: {
    onRequest: (callback: (data: any) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: any): void => {
        callback(data)
      }
      ipcRenderer.on('approval:request', handler)
      return () => {
        ipcRenderer.removeListener('approval:request', handler)
      }
    },
    respond: (requestId: string, decision: 'approve' | 'deny', remember: boolean): Promise<boolean> => {
      return ipcRenderer.invoke('approval:respond', { requestId, decision, remember })
    }
  },

  security: {
    listRisks: (): Promise<Record<string, string>> => {
      return ipcRenderer.invoke('security:listRisks')
    },
    getMode: (): Promise<'default' | 'full'> => {
      return ipcRenderer.invoke('security:getMode')
    },
    setMode: (mode: 'default' | 'full'): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('security:setMode', mode)
    },
    listPolicies: (): Promise<Record<string, 'allow' | 'ask' | 'deny'>> => {
      return ipcRenderer.invoke('security:listPolicies')
    },
    setPolicy: (toolName: string, action: 'allow' | 'ask' | 'deny' | null): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('security:setPolicy', toolName, action)
    },
    listRemembered: (): Promise<Array<{ fingerprint: string; toolName: string; argsSummary: string; ts: number }>> => {
      return ipcRenderer.invoke('security:listRemembered')
    },
    forgetRemembered: (fingerprint: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('security:forgetRemembered', fingerprint)
    },
    listAudit: (limit?: number): Promise<any[]> => {
      return ipcRenderer.invoke('security:listAudit', limit)
    },
    clearAudit: (): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('security:clearAudit')
    },
    listProtected: (): Promise<string[]> => {
      return ipcRenderer.invoke('security:listProtected')
    },
    addProtected: (p: string): Promise<{ success: boolean; error?: string }> => {
      return ipcRenderer.invoke('security:addProtected', p)
    },
    removeProtected: (p: string): Promise<{ success: boolean }> => {
      return ipcRenderer.invoke('security:removeProtected', p)
    },
    pickProtectedDirectory: (): Promise<string | null> => {
      return ipcRenderer.invoke('security:pickProtectedDirectory')
    }
  },

  menu: {
    onAction: (callback: (data: { action: string; payload?: unknown }) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { action: string; payload?: unknown }): void => {
        callback(data)
      }
      ipcRenderer.on('menu:action', handler)
      return () => {
        ipcRenderer.removeListener('menu:action', handler)
      }
    }
  },

  dsh: {
    getPort: (): Promise<number> => {
      return ipcRenderer.invoke('dsh:getPort')
    },
    getConfig: (): Promise<{ port: number; preloadPath: string }> => {
      return ipcRenderer.invoke('dsh:getConfig')
    },
    listPlugins: (): Promise<Array<{ name: string; version: string; packageDir: string }>> => {
      return ipcRenderer.invoke('dsh:listPlugins')
    },
    installPlugin: (packageDir: string): Promise<{ success: boolean; name?: string; error?: string }> => {
      return ipcRenderer.invoke('dsh:installPlugin', packageDir)
    },
    onOpenSessionRequest: (callback: (sessionId: string) => void): (() => void) => {
      const handler = (_event: Electron.IpcRendererEvent, sessionId: string): void => {
        callback(sessionId)
      }
      ipcRenderer.on('dsh:openSessionRequest', handler)
      return () => {
        ipcRenderer.removeListener('dsh:openSessionRequest', handler)
      }
    }
  }
}

contextBridge.exposeInMainWorld('aeromind', api)
