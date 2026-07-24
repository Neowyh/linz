import initSqlJs, { Database as SqlJsDatabase } from 'sql.js'
import path from 'path'
import { app } from 'electron'
import fs from 'fs'
import { ConversationsRepo } from './conversations.repo'
import { MessagesRepo } from './messages.repo'

let db: SqlJsDatabase
let conversationsRepo: ConversationsRepo
let messagesRepo: MessagesRepo
let dbPath: string
let sqlJsModule: initSqlJs.SqlJsStatic | null = null
let dbSwitching = false

export interface Conversation {
  id: string
  title: string | null
  created_at: string
  updated_at: string
  task_type: string | null
  agents_used: string
  total_tokens: number
  status: string
}

export interface Message {
  id: string
  conversation_id: string
  role: string
  agent_type: string | null
  content: string
  tokens: number
  created_at: string
}

// 保存数据库到磁盘
export function saveDatabase(): void {
  if (db && dbPath) {
    const data = db.export()
    const buffer = Buffer.from(data)
    fs.writeFileSync(dbPath, buffer)
  }
}

// 延迟保存（防抖，避免频繁写入）
let saveTimer: NodeJS.Timeout | null = null
function debounceSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(saveDatabase, 1000)
}

export async function initDatabase(customDbPath?: string): Promise<SqlJsDatabase> {
  dbPath = customDbPath || path.join(app.getPath('userData'), 'aeromind.db')

  // sql.js 需要加载 WASM 文件，在 Electron 中指定路径
  const wasmPath = path.join(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm')

  if (!sqlJsModule) {
    sqlJsModule = await initSqlJs({
      locateFile: (file: string) => {
        if (fs.existsSync(wasmPath)) {
          return wasmPath
        }
        return file
      }
    })
  }

  // 如果已有数据库文件，加载它
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath)
    db = new sqlJsModule.Database(fileBuffer)
  } else {
    db = new sqlJsModule.Database()
  }

  // 建表
  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      task_type TEXT,
      agents_used TEXT DEFAULT '[]',
      total_tokens INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active'
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      agent_type TEXT,
      content TEXT,
      tokens INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id, created_at);`)

  // 自动任务表
  db.run(`
    CREATE TABLE IF NOT EXISTS auto_tasks (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      cron_expression TEXT NOT NULL,
      agents TEXT DEFAULT '[]',
      is_active INTEGER DEFAULT 1,
      last_run TEXT,
      next_run TEXT,
      run_count INTEGER DEFAULT 0,
      result_action TEXT DEFAULT 'notify',
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // 模板表（提示词/任务模板，区别于 agent_skills 过程性知识技能）
  // 迁移：旧版本表名为 skills，重命名为 templates
  try {
    const oldTable = db.exec("SELECT name FROM sqlite_master WHERE type='table' AND name='skills'")
    if (oldTable[0] && oldTable[0].values.length > 0) {
      db.run('ALTER TABLE skills RENAME TO templates')
      console.log('[Database] Renamed table skills → templates')
    }
  } catch (err) {
    console.warn('[Database] skills→templates rename migration skipped:', err)
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      description TEXT,
      prompt_template TEXT NOT NULL,
      agents TEXT DEFAULT '[]',
      input_params TEXT DEFAULT '[]',
      output_format TEXT DEFAULT 'markdown',
      is_builtin INTEGER DEFAULT 1,
      usage_count INTEGER DEFAULT 0,
      rating REAL DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // Agent 技能表（真正的过程性知识技能，运行时注入 Agent 系统提示词）
  db.run(`
    CREATE TABLE IF NOT EXISTS agent_skills (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      content TEXT NOT NULL,
      target_agents TEXT DEFAULT '[]',
      trigger_keywords TEXT DEFAULT '[]',
      priority INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      is_builtin INTEGER DEFAULT 0,
      is_custom INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // 知识库文档表
  db.run(`
    CREATE TABLE IF NOT EXISTS kb_documents (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL,
      file_name TEXT NOT NULL,
      file_type TEXT NOT NULL,
      domain_category TEXT DEFAULT '未分类',
      index_status TEXT DEFAULT 'pending',
      chunk_count INTEGER DEFAULT 0,
      file_size INTEGER DEFAULT 0,
      added_at TEXT DEFAULT (datetime('now')),
      indexed_at TEXT
    );
  `)

  // 知识库文本块表（用于关键词检索）
  db.run(`
    CREATE TABLE IF NOT EXISTS kb_chunks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      content TEXT NOT NULL,
      chunk_index INTEGER DEFAULT 0,
      chapter_title TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (document_id) REFERENCES kb_documents(id) ON DELETE CASCADE
    );
  `)

  db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_doc ON kb_chunks(document_id);`)
  db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_content ON kb_chunks(content);`)

  // 向量嵌入列迁移（添加 embedding BLOB 列到 kb_chunks 表）
  try {
    const columns = db.exec("PRAGMA table_info(kb_chunks)")
    const hasEmbedding = columns[0]?.values.some((row) => row[1] === 'embedding')
    if (!hasEmbedding) {
      db.run('ALTER TABLE kb_chunks ADD COLUMN embedding BLOB')
      console.log('[Database] Added embedding column to kb_chunks')
    }
  } catch (err) {
    console.warn('[Database] Embedding column migration skipped:', err)
  }

  // templates 表迁移：添加 is_custom 列
  try {
    const skillColumns = db.exec("PRAGMA table_info(templates)")
    const hasIsCustom = skillColumns[0]?.values.some((row) => row[1] === 'is_custom')
    if (!hasIsCustom) {
      db.run('ALTER TABLE templates ADD COLUMN is_custom INTEGER DEFAULT 0')
      console.log('[Database] Added is_custom column to templates')
    }
  } catch (err) {
    console.warn('[Database] is_custom column migration skipped:', err)
  }

  // 自定义 Agent 表
  db.run(`
    CREATE TABLE IF NOT EXISTS custom_agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT NOT NULL DEFAULT '#1890FF',
      icon TEXT NOT NULL DEFAULT '🎯',
      system_prompt TEXT NOT NULL,
      tools TEXT DEFAULT '[]',
      keywords TEXT DEFAULT '[]',
      subtask_prefix TEXT,
      model_name TEXT DEFAULT 'deepseek-chat',
      is_custom INTEGER DEFAULT 1,
      usage_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // Migration: add delegates_to column to custom_agents
  try {
    const delegatesToCol = db.exec("PRAGMA table_info(custom_agents)")
    const hasDelegatesTo = delegatesToCol[0]?.values?.some((col: any) => col[1] === 'delegates_to')
    if (!hasDelegatesTo) {
      db.run('ALTER TABLE custom_agents ADD COLUMN delegates_to TEXT DEFAULT \'[]\'')
      console.log('[DB] Added delegates_to column to custom_agents')
    }
  } catch (err) {
    console.warn('[DB] Migration: delegates_to column may already exist:', err)
  }

  // Migration: add engine column to custom_agents ('deepseek' | 'pi')
  try {
    const engineCol = db.exec("PRAGMA table_info(custom_agents)")
    const hasEngine = engineCol[0]?.values?.some((col: any) => col[1] === 'engine')
    if (!hasEngine) {
      db.run('ALTER TABLE custom_agents ADD COLUMN engine TEXT DEFAULT \'deepseek\'')
      console.log('[DB] Added engine column to custom_agents')
    }
  } catch (err) {
    console.warn('[DB] Migration: engine column may already exist:', err)
  }

  // MCP 服务器表（每个工作区独立一份）
  db.run(`
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      icon TEXT DEFAULT '🔌',
      transport TEXT NOT NULL DEFAULT 'stdio',
      command TEXT,
      args TEXT DEFAULT '[]',
      cwd TEXT,
      env TEXT DEFAULT '{}',
      url TEXT,
      enabled INTEGER DEFAULT 1,
      auto_start INTEGER DEFAULT 1,
      status TEXT DEFAULT 'disconnected',
      last_error TEXT,
      last_connected_at TEXT,
      tool_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );
  `)

  // Seed built-in agent rows
  initBuiltinAgentRows(db)

  // 初始化内置模板
  initBuiltinTemplates(db)

  // 初始保存
  saveDatabase()

  conversationsRepo = new ConversationsRepo(db, debounceSave)
  messagesRepo = new MessagesRepo(db, debounceSave)

  return db
}

export function getDatabase(): SqlJsDatabase {
  if (dbSwitching) {
    throw new Error('Database is switching workspaces, please retry')
  }
  return db
}

export async function switchDatabase(newPath: string): Promise<SqlJsDatabase> {
  // Clear debounce timer to avoid writing to wrong DB
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = null
  }

  dbSwitching = true
  try {
    // Save current database first
    saveDatabase()

    // Close current connection
    if (db) {
      try {
        db.close()
      } catch {
        // Ignore close errors
      }
    }

    // Re-init with new path (reuses cached sqlJsModule)
    return await initDatabase(newPath)
  } finally {
    dbSwitching = false
  }
}

export function getConversationsRepo(): ConversationsRepo {
  return conversationsRepo
}

export function getMessagesRepo(): MessagesRepo {
  return messagesRepo
}

export { debounceSave }

// 存储文本块的向量嵌入
export function addChunkEmbedding(chunkId: string, embedding: number[]): void {
  if (!db) return
  const buffer = Buffer.from(new Float32Array(embedding).buffer)
  db.run('UPDATE kb_chunks SET embedding = ? WHERE id = ?', [buffer, chunkId])
  debounceSave()
}

// 余弦相似度计算
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dot = 0, normA = 0, normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

// 基于向量的语义搜索
export function searchByVector(
  queryEmbedding: number[],
  topK = 10
): Array<{ chunkId: string; documentId: string; content: string; score: number }> {
  if (!db) return []

  const result = db.exec('SELECT id, document_id, content, embedding FROM kb_chunks WHERE embedding IS NOT NULL')
  if (!result[0]) return []

  const scored: Array<{ chunkId: string; documentId: string; content: string; score: number }> = []

  for (const row of result[0].values) {
    const chunkId = row[0] as string
    const documentId = row[1] as string
    const content = row[2] as string
    const embeddingBlob = row[3] as Buffer | null

    if (!embeddingBlob) continue

    try {
      const float32 = new Float32Array(embeddingBlob.buffer, embeddingBlob.byteOffset, embeddingBlob.byteLength / 4)
      const embedding = Array.from(float32)
      const score = cosineSimilarity(queryEmbedding, embedding)
      if (score > 0) {
        scored.push({ chunkId, documentId, content, score })
      }
    } catch {
      // Skip chunks with corrupted embeddings
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK)
}

// Seed built-in agent rows into custom_agents table
function initBuiltinAgentRows(db: SqlJsDatabase) {
  const builtinAgents = getBuiltinAgentSeedData()

  for (const agent of builtinAgents) {
    db.run(
      `INSERT OR IGNORE INTO custom_agents (id, name, description, color, icon, system_prompt, tools, keywords, delegates_to, subtask_prefix, model_name, is_custom, engine)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [agent.id, agent.name, agent.description, agent.color, agent.icon, agent.system_prompt, agent.tools, agent.keywords, agent.delegates_to, agent.subtask_prefix, agent.model_name, agent.engine]
    )
  }
  console.log('[DB] Seeded built-in agent rows')
}

// Re-seed a single built-in agent by id (used for reset)
export function seedSingleBuiltinAgent(agentId: string): boolean {
  if (!db) return false

  // Find the agent definition from the seed data
  const allBuiltin = getBuiltinAgentSeedData()
  const agent = allBuiltin.find(a => a.id === agentId)
  if (!agent) return false

  db.run(
    `INSERT OR IGNORE INTO custom_agents (id, name, description, color, icon, system_prompt, tools, keywords, delegates_to, subtask_prefix, model_name, is_custom, engine)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    [agent.id, agent.name, agent.description, agent.color, agent.icon, agent.system_prompt, agent.tools, agent.keywords, agent.delegates_to, agent.subtask_prefix, agent.model_name, agent.engine]
  )
  debounceSave()
  return true
}

function getBuiltinAgentSeedData() {
  return [
    {
      id: 'orchestrator', name: '协调 Agent', description: '任务分析与Agent调度协调', color: '#722ED1', icon: 'assets/icons/orchestrator.svg',
      system_prompt: '你是临智LINZ的协调Agent，负责分析用户飞行器设计任务并调度专业Agent。\\n\\n可调度的专业Agent：\\n- 气动Agent(aero): 气动分析、翼型评估、升阻计算、CFD前处理\\n- 结构Agent(structural): 结构设计、强度刚度、材料选择、疲劳分析\\n- 推进Agent(propulsion): 发动机选型、推力分析、燃油系统\\n- 航电Agent(avionics): 飞控架构、传感器、通信导航、电气系统\\n- 仿真Agent(simulation): CFD/FEM仿真预处理、求解器设置、结果解读\\n- 文档Agent(documentation): 技术报告、GJB文档、设计评审材料\\n- 检索Agent(retriever): 知识检索、文献调研、标准规范\\n- 普通对话Agent(general): 通用问答、闲聊、非专业领域问题\\n\\nAgent间委派关系：气动→仿真/检索，结构→仿真/检索，推进→检索，航电→检索，仿真→气动/检索，文档→检索，普通对话→检索\\n\\n调度原则：根据关键词识别专业领域自动调度，多Agent可并发(最多3个)，调度前先说明分析思路，汇总时检查参数一致性。未匹配专业关键词时默认路由到普通对话Agent。',
      tools: '[]', keywords: '[]', delegates_to: '["general","aero","structural","propulsion","avionics","simulation","documentation","retriever"]',
      subtask_prefix: '', model_name: 'deepseek-chat', engine: 'deepseek'
    },
    {
      id: 'general', name: '普通对话', description: '通用对话与日常问答', color: '#1677FF', icon: 'assets/icons/general.svg',
      system_prompt: '你是临智LINZ的普通对话Agent，负责处理用户的通用对话与日常问答需求。\\n\\n职责：通用问答、概念解释、闲聊澄清、跨域引导（识别到专业需求时提示用户切换专业Agent）。\\n\\n行为准则：语言自然简洁，不过度结构化；不确定的事实明确标注，不编造数据；不冒充专业Agent给出深度专业结论，遇到专业问题引导用户切换Agent。\\n\\n输出：Markdown轻量格式，中文为主。',
      tools: '["calculator","knowledge_search"]', keywords: '[]', delegates_to: '["retriever"]',
      subtask_prefix: '', model_name: 'deepseek-chat', engine: 'pi'
    },
    {
      id: 'aero', name: '气动 Agent', description: '飞行器气动分析与设计', color: '#1E6FCC', icon: 'assets/icons/aero.svg',
      system_prompt: '你是一位资深飞行器气动设计工程师。你擅长：\n- 翼型气动特性分析（Cl, Cd, Cm）\n- 机翼气动设计（展弦比、后掠角、尖削比优化）\n- 升阻比估算与优化\n- 巡航性能分析\n- CFD仿真预处理建议\n- 气动布局评估\n\n方法：基于经典气动手册方法（Anderson, Raymer, Torenbeek）。诚实标注精度，使用标准气动参数和术语，Markdown输出包含表格和LaTeX公式。安全提示：超范围参数警告，标注置信度（高/中/低），强调验证需求，结果仅为初步设计参考。',
      tools: '["aero_calculator","calculator","knowledge_search","xfoil"]',
      keywords: '["翼型","升力","阻力","升阻比","气动","马赫数","迎角","后掠角","展弦比","CFD","翼展","NACA","机翼","巡航速度","失速","俯仰力矩","压力分布","边界层","湍流","雷诺数","螺旋桨","涡流","激波","cfd","airfoil","lift","drag","wing"]',
      delegates_to: '["simulation","retriever"]',
      subtask_prefix: '作为气动分析工程师，请对以下飞行器设计任务进行气动分析：\n\n', model_name: 'deepseek-chat', engine: 'deepseek'
    },
    {
      id: 'structural', name: '结构 Agent', description: '飞行器结构设计与分析', color: '#FA8C16', icon: 'assets/icons/structural.svg',
      system_prompt: '你是一位资深飞行器结构设计工程师。你擅长：\n- 结构设计与选型\n- 强度与刚度估算\n- 材料选择与对比（铝合金、复合材料、钛合金）\n- 疲劳寿命初步评估\n- 连接件载荷分布分析\n- 结构拓扑优化建议\n\n方法：优先工程估算方法（Raymer, Niu手册）。诚实标注精度，合理假设和安全系数，使用标准结构参数和术语。输出：Markdown含表格（符号、数值、单位），加粗关键结论，分析与设计建议。安全提示：超范围参数警告，标注置信度，强调结构安全裕度和验证需求，结果仅为初步设计参考。',
      tools: '["calculator","knowledge_search"]',
      keywords: '["结构","强度","刚度","材料","疲劳","载荷","复合材料","铝合金","铺层","连接件","有限元","FEM","梁截面","拓扑优化"]',
      delegates_to: '["simulation","retriever"]',
      subtask_prefix: '作为结构设计工程师，请对以下飞行器设计任务进行结构分析：\n\n', model_name: 'deepseek-chat', engine: 'deepseek'
    },
    {
      id: 'propulsion', name: '推进 Agent', description: '飞行器推进系统设计', color: '#CF1322', icon: 'assets/icons/propulsion.svg',
      system_prompt: '你是一位资深飞行器推进系统设计工程师。你擅长：\n- 发动机性能匹配计算\n- 电推进能量分析\n- 螺旋桨效率曲线生成\n- 燃油系统重量估算\n- 推力需求分析与推重比\n- 推进方案对比（电动/活塞/涡扇/涡桨）\n\n方法：基于标准发动机性能参数，诚实标注精度，合理假设，考虑各飞行阶段推力需求。输出：Markdown含表格，加粗关键结论，方案对比与推荐。安全提示：标注置信度，超范围参数警告，结果仅为初步设计参考。',
      tools: '["calculator","knowledge_search"]',
      keywords: '["推进","发动机","推力","燃油","涡扇","活塞","电机","推重比","桨盘","能量","电池","耗油率"]',
      delegates_to: '["retriever"]',
      subtask_prefix: '作为推进系统工程师，请对以下飞行器设计任务进行推进系统分析：\n\n', model_name: 'deepseek-chat', engine: 'deepseek'
    },
    {
      id: 'avionics', name: '航电 Agent', description: '飞行器航电系统设计', color: '#08979C', icon: 'assets/icons/avionics.svg',
      system_prompt: '你是一位资深飞行器航电系统设计工程师。你擅长：\n- 飞控系统架构设计\n- 传感器选型（IMU、气压计、GPS等）\n- 通信链路设计（频段、功率、天线）\n- 电气系统设计（供电、配电）\n- 导航系统设计\n- EMC/EMI考虑\n\n方法：基于行业标准（RTCA DO-160, MIL-STD-461），考虑系统可靠性和冗余，成本效益分析。输出：Markdown含表格，加粗关键结论，方案对比与推荐。安全提示：标注置信度，强调安全性要求，结果仅为初步设计参考。',
      tools: '["knowledge_search"]',
      keywords: '["航电","飞控","传感器","通信","导航","GPS","IMU","电气","电磁","EMC","天线"]',
      delegates_to: '["retriever"]',
      subtask_prefix: '作为航电系统工程师，请对以下飞行器设计任务进行航电系统分析：\n\n', model_name: 'deepseek-chat', engine: 'deepseek'
    },
    {
      id: 'simulation', name: '仿真 Agent', description: '飞行器仿真分析', color: '#722ED1', icon: 'assets/icons/simulation.svg',
      system_prompt: '你是一位资深飞行器仿真工程师。你擅长：\n- CFD仿真预处理（边界条件、网格要求、湍流模型）\n- FEM仿真预处理（载荷、约束、网格）\n- 仿真结果解读与后处理\n- XFOIL/OpenFOAM/SU2工具使用指导\n- 仿真参数敏感性分析\n- 计算资源与时间估算\n\n方法：基于仿真最佳实践，合理网格密度和求解器设置，评估仿真结果可信度。输出：Markdown含参数设置表格，加粗关键结论，仿真方案与注意事项。',
      tools: '["calculator","knowledge_search","xfoil"]',
      keywords: '["仿真","OpenFOAM","SU2","XFOIL","网格","求解器","RANS","LES","后处理","前处理"]',
      delegates_to: '["aero","retriever"]',
      subtask_prefix: '作为仿真工程师，请对以下飞行器设计任务提供仿真方案建议：\n\n', model_name: 'deepseek-chat', engine: 'deepseek'
    },
    {
      id: 'documentation', name: '文档 Agent', description: '飞行器设计文档生成', color: '#389E0D', icon: 'assets/icons/documentation.svg',
      system_prompt: '你是一位资深飞行器设计文档工程师。你擅长：\n- GJB格式技术报告生成\n- 设计评审PPT内容组织\n- 参数汇总表编制\n- 需求追溯矩阵生成\n- 设计总结撰写\n- 实验报告编制\n\n输出规范：严格遵循GJB文档格式，标准工程术语，清晰表格准确数据，明确引用来源，完整章节结构。输出：Markdown含多级标题、表格、LaTeX公式、规范参考文献格式。注意：确保数据准确性和一致性，标注数据来源和版本，标记未验证数据，区分设计值与估算值。',
      tools: '["knowledge_search"]',
      keywords: '["报告","PPT","文档","GJB","技术报告","设计评审","综述"]',
      delegates_to: '["retriever"]',
      subtask_prefix: '作为文档工程师，请根据以下飞行器设计任务生成技术文档：\n\n', model_name: 'deepseek-chat', engine: 'deepseek'
    },
    {
      id: 'retriever', name: '检索 Agent', description: '知识检索与整合', color: '#1890FF', icon: 'assets/icons/retriever.svg',
      system_prompt: '你是飞行器设计领域的文献检索与知识整合专家。你擅长：\n- 飞行器设计文献检索与综述\n- 技术标准与规范查找\n- 相关案例与参考方案整理\n- 学术论文要点提取\n- 技术参数数据核实\n- 跨学科知识整合\n\n方法：基于公开文献和标准，标注信息来源和可靠性，区分已验证与估算数据，多源交叉验证。输出：Markdown含规范参考文献列表，加粗关键发现，明确来源标注。注意：标注来源和时效性，标记无法验证信息为"待查证"，区分"行业通用做法"与"特定案例数据"，建议进一步查询方向。',
      tools: '["knowledge_search"]',
      keywords: '["文献","标准","规范","案例","参考","查","调研"]',
      delegates_to: '[]',
      subtask_prefix: '作为知识检索专家，请针对以下飞行器设计任务进行相关知识检索与整理：\n\n', model_name: 'deepseek-chat', engine: 'deepseek'
    }
  ]
}

// 内置模板数据
function initBuiltinTemplates(db: SqlJsDatabase): void {
  // 检查是否已初始化
  const result = db.exec("SELECT COUNT(*) FROM templates WHERE is_builtin = 1")
  if (result[0] && result[0].values[0] && (result[0].values[0][0] as number) > 0) return

  const builtinTemplates = [
    {
      id: 'skill-naca-airfoil',
      name: 'NACA翼型全套分析',
      category: '气动分析',
      description: '升力/阻力/力矩曲线 + 失速特性一键生成',
      prompt_template: '请对NACA {airfoil_id}翼型进行完整的气动分析，包括：\n1. 不同迎角下的升力系数Cl变化\n2. 阻力系数Cd变化\n3. 俯仰力矩系数Cm变化\n4. 最大升阻比及对应迎角\n5. 失速特性分析\n\n巡航马赫数：{mach_number}\n雷诺数范围：{reynolds_range}',
      agents: '["aero"]',
      input_params: '[{"key":"airfoil_id","label":"翼型编号","default":"2412"},{"key":"mach_number","label":"马赫数","default":"0.3"},{"key":"reynolds_range","label":"雷诺数范围","default":"3e6-6e6"}]',
      is_builtin: 1,
      usage_count: 128,
      rating: 5.0
    },
    {
      id: 'skill-param-estimate',
      name: '总体参数快速估算',
      category: '总体设计',
      description: '给定载重和航程，估算起飞重量等总体参数',
      prompt_template: '请根据以下需求进行飞行器总体参数快速估算（Raymer方法）：\n\n任务需求：\n- 载重：{payload} kg\n- 航程：{range} km\n- 巡航速度：{cruise_speed} km/h\n\n请给出：\n1. 起飞重量估算\n2. 空机重量估算\n3. 燃油重量估算\n4. 翼面积估算\n5. 展弦比建议\n6. 起飞推重比',
      agents: '["orchestrator","aero"]',
      input_params: '[{"key":"payload","label":"载重(kg)","default":"50"},{"key":"range","label":"航程(km)","default":"500"},{"key":"cruise_speed","label":"巡航速度(km/h)","default":"200"}]',
      is_builtin: 1,
      usage_count: 76,
      rating: 4.5
    },
    {
      id: 'skill-propulsion-match',
      name: '推进系统匹配计算',
      category: '推进设计',
      description: '根据飞行包线自动匹配最优发动机型号',
      prompt_template: '请根据以下飞行包线进行推进系统匹配分析：\n\n- 最大起飞重量：{mtow} kg\n- 巡航速度：{cruise_speed} km/h\n- 最大速度：{max_speed} km/h\n- 实用升限：{ceiling} m\n- 航程：{range} km\n\n请推荐合适的推进方案（电动/活塞/涡扇），给出推力需求计算和发动机选型建议。',
      agents: '["propulsion"]',
      input_params: '[{"key":"mtow","label":"最大起飞重量(kg)","default":"500"},{"key":"cruise_speed","label":"巡航速度(km/h)","default":"250"},{"key":"max_speed","label":"最大速度(km/h)","default":"350"},{"key":"ceiling","label":"实用升限(m)","default":"8000"},{"key":"range","label":"航程(km)","default":"1000"}]',
      is_builtin: 1,
      usage_count: 56,
      rating: 4.0
    },
    {
      id: 'skill-struct-design',
      name: '机翼结构初步设计',
      category: '结构强度',
      description: '机翼梁截面初步设计与复合材料铺层方案',
      prompt_template: '请对以下机翼进行结构初步设计：\n\n- 半翼展：{half_span} m\n- 翼根弦长：{root_chord} m\n- 设计载荷系数：{load_factor} g\n- 最大起飞重量：{mtow} kg\n\n请给出：\n1. 翼根弯矩和剪力估算\n2. 主梁截面尺寸建议\n3. 复合材料铺层方案（如适用）\n4. 关键连接件载荷分析\n5. 疲劳寿命初步评估',
      agents: '["structural"]',
      input_params: '[{"key":"half_span","label":"半翼展(m)","default":"5"},{"key":"root_chord","label":"翼根弦长(m)","default":"1.5"},{"key":"load_factor","label":"设计载荷系数(g)","default":"3.5"},{"key":"mtow","label":"最大起飞重量(kg)","default":"500"}]',
      is_builtin: 1,
      usage_count: 42,
      rating: 4.0
    },
    {
      id: 'skill-cfd-prep',
      name: 'CFD前处理建议',
      category: '气动分析',
      description: 'RANS仿真边界条件设置与网格要求建议',
      prompt_template: '请为以下飞行器提供RANS CFD仿真的前处理建议：\n\n- 飞行器类型：{aircraft_type}\n- 巡航速度：{cruise_speed} km/h\n- 分析目标：{analysis_goal}\n\n请给出：\n1. 来流条件设置（马赫数、雷诺数、湍流度）\n2. 湍流模型选择建议\n3. 计算域尺寸建议\n4. 边界层网格要求（y+值）\n5. 网格总数量级估计\n6. 求解器设置建议',
      agents: '["aero","simulation"]',
      input_params: '[{"key":"aircraft_type","label":"飞行器类型","default":"小型无人机"},{"key":"cruise_speed","label":"巡航速度(km/h)","default":"200"},{"key":"analysis_goal","label":"分析目标","default":"机翼升阻力特性"}]',
      is_builtin: 1,
      usage_count: 34,
      rating: 4.5
    },
    {
      id: 'skill-report-gen',
      name: 'GJB格式技术报告生成',
      category: '文档输出',
      description: '按GJB格式自动生成设计报告',
      prompt_template: '请根据以下设计内容，生成一份符合GJB格式的飞行器设计技术报告：\n\n设计内容概述：{design_summary}\n\n报告应包含：\n1. 概述（设计依据、目的）\n2. 设计要求与技术指标\n3. 总体方案描述\n4. 各专业分析结果\n5. 结论与建议\n6. 参考文献列表',
      agents: '["documentation"]',
      input_params: '[{"key":"design_summary","label":"设计内容概述","default":"本次设计为XXX型无人机，巡航速度200km/h，航程500km，载重50kg"}]',
      is_builtin: 1,
      usage_count: 210,
      rating: 5.0
    },
    {
      id: 'skill-avionics-design',
      name: '航电系统方案设计',
      category: '航电控制',
      description: '控制系统、传感器方案、通信链路设计',
      prompt_template: '请为以下飞行器进行航电系统方案设计：\n\n- 飞行器类型：{aircraft_type}\n- 自主等级：{autonomy_level}\n- 通信距离需求：{comm_range} km\n- 任务类型：{mission_type}\n\n请给出：\n1. 飞控系统架构建议\n2. 传感器选型方案（IMU、气压计、GPS等）\n3. 通信链路设计（频段、功率、天线）\n4. 电气系统方案（电源、配电）\n5. 线缆走向与EMC考虑',
      agents: '["avionics"]',
      input_params: '[{"key":"aircraft_type","label":"飞行器类型","default":"固定翼无人机"},{"key":"autonomy_level","label":"自主等级","default":"全自主"},{"key":"comm_range","label":"通信距离(km)","default":"50"},{"key":"mission_type","label":"任务类型","default":"侦察监视"}]',
      is_builtin: 1,
      usage_count: 28,
      rating: 4.0
    },
    {
      id: 'skill-flap-design',
      name: '多段翼增升装置设计',
      category: '气动分析',
      description: '含增升装置的多段翼设计与气动评估',
      prompt_template: '请对以下多段翼增升装置进行设计分析：\n\n- 主翼型：{main_airfoil}\n- 襟翼类型：{flap_type}\n- 襟翼偏转角：{flap_deflection}°\n- 设计升力系数目标：{cl_target}\n\n请给出：\n1. 襟翼几何参数建议（弦长比、缝隙宽度）\n2. 增升效果估算\n3. 失速特性变化分析\n4. 不同襟翼偏度下的Clmax变化\n5. 配平代价评估',
      agents: '["aero"]',
      input_params: '[{"key":"main_airfoil","label":"主翼型","default":"NACA 23012"},{"key":"flap_type","label":"襟翼类型","default":"单缝富勒襟翼"},{"key":"flap_deflection","label":"襟翼偏转角(°)","default":"30"},{"key":"cl_target","label":"设计Cl目标","default":"2.5"}]',
      is_builtin: 1,
      usage_count: 34,
      rating: 4.5
    }
  ]

  for (const template of builtinTemplates) {
    db.run(
      `INSERT OR IGNORE INTO templates (id, name, category, description, prompt_template, agents, input_params, is_builtin, usage_count, rating)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [template.id, template.name, template.category, template.description, template.prompt_template, template.agents, template.input_params, template.is_builtin, template.usage_count, template.rating]
    )
  }
  debounceSave()
}

// 种子内置 Agent 技能（真正的过程性知识技能，运行时注入 Agent 系统提示词）
// 内置技能 is_builtin=1, is_custom=0；用户不可改不可删
export function seedBuiltinAgentSkills(db: any): void {
  const builtinAgentSkills = [
    {
      id: 'agent-skill-airfoil-analysis',
      name: '翼型分析流程',
      description: 'NACA 翼型气动分析的标准步骤，确保覆盖雷诺数估算、XFOIL 调用、Cl/Cd 曲线、失速特性',
      content: `当用户询问翼型相关问题时，按以下步骤分析：

1. **确认翼型编号**：NACA 4 位（如 NACA 2412）、5 位、6 位系列，或自定义翼型文件
2. **估算工况雷诺数**：Re = ρ·v·c / μ，c 为弦长，需基于飞行工况合理估算
3. **调用 XFOIL 工具**：用 xfoil 工具获取指定雷诺数、马赫数下，迎角 -5°~15° 范围的 Cl/Cd/Cm 数据
4. **分析 Cl-α 曲线**：线性段斜率、失速迎角、最大升力系数 Clmax
5. **分析升阻比**：L/D 随迎角变化，找出最大升阻比对应迎角
6. **输出表格**：以 markdown 表格给出 α / Cl / Cd / Cm / L/D 关键数据点
7. **结论**：适用飞行段、失速特性、配平代价评估

注意：若用户未提供雷诺数/弦长，先估算并询问；XFOIL 未安装时给出安装指引并退化为经验公式估算。`,
      target_agents: '["aero"]',
      trigger_keywords: '["翼型","airfoil","NACA","升力","阻力","Cl","Cd"]',
      priority: 100
    },
    {
      id: 'agent-skill-cfd-mesh',
      name: 'CFD 网格划分建议',
      description: 'CFD 仿真网格划分规范，覆盖边界层 Y+、近场加密、远场距离、网格质量评估',
      content: `当任务涉及 CFD 网格划分时，按以下规范给出建议：

1. **边界层 Y+ 估算**：
   - 目标 Y+：壁面函数 ≤ 30~300，直接求解 ≤ 1
   - 首层网格高度 y₁ ≈ 6·Re_x^(-4/5) · (Y+ / Re_∞) · L（按目标 Y+ 反推）
2. **近场加密**：翼型周围弦长 10~20 倍范围加密，growth ratio ≤ 1.2
3. **远场距离**：翼型距远场边界 ≥ 50 倍弦长，避免边界反射
4. **网格类型**：O 型网格适合翼型，C 型适合后缘流动，H 型适合简单外形
5. **网格量估算**：基于 Re 和模型尺度，给出粗/中/细三档网格量级建议
6. **质量指标**：正交性 ≥ 0.3，长宽比 ≤ 1000~10000（视位置），膨胀比 ≤ 1.2
7. **网格无关性验证**：建议做 3 套网格收敛性研究（GCI 方法）

输出格式：先给推荐参数表（Y+ / 首层高度 / 网格量 / 类型），再列注意事项。`,
      target_agents: '["simulation"]',
      trigger_keywords: '["网格","CFD","OpenFOAM","SU2","Y+","网格划分"]',
      priority: 90
    },
    {
      id: 'agent-skill-fem-modeling',
      name: '结构有限元建模要点',
      description: '结构有限元分析建模规范，覆盖单元类型、网格密度、边界条件、载荷施加',
      content: `当任务涉及结构有限元建模时，按以下要点给出建议：

1. **单元类型选择**：
   - 薄板/壳结构：Shell 单元（四边形 4 节点 S4R 或 8 节点 S8R）
   - 厚壁/复杂结构：实体单元（六面体 C3D8R 优先，复杂几何可用四面体 C3D10M）
   - 长细比 > 10 的梁：Beam 单元（B31 或 B33）
2. **网格密度**：应力集中区（孔、缺口、连接处）加密，单元过渡平滑，网格量根据精度需求分层
3. **边界条件**：
   - 对称结构用对称约束，减少模型规模
   - 固支/铰支/弹性支撑需明确物理意义
   - 避免过约束（导致局部应力虚高）
4. **载荷施加**：气动载荷分布施加在表面，集中力施加在节点，惯性载荷用 Body Force
5. **材料模型**：线弹性、弹塑性、粘弹性、复合材料（需铺层定义）
6. **分析类型**：静强度（线性/非线性）、模态、屈曲、疲劳、瞬态
7. **后处理**：von Mises 应力、位移、安全系数（材料强度/工作应力），关注网格收敛性

输出格式：先列建模方案（单元/网格/边界/载荷），再列后处理关注点和验证项。`,
      target_agents: '["structural"]',
      trigger_keywords: '["有限元","FEM","强度","刚度","建模","网格划分"]',
      priority: 90
    },
    {
      id: 'agent-skill-tech-report-gjb',
      name: '技术报告撰写规范',
      description: 'GJB 格式技术报告撰写规范，覆盖章节结构、图表编号、参考文献、术语一致性',
      content: `当任务涉及生成技术报告（特别是 GJB 格式）时，按以下规范撰写：

1. **章节结构**（GJB 标准）：
   - 概述（设计依据、目的、范围）
   - 设计要求与技术指标
   - 总体方案描述
   - 各专业分析结果（气动/结构/推进/航电/仿真）
   - 结论与建议
   - 参考文献
2. **图表编号**：图 X-Y（章-序号）、表 X-Y，每章独立编号；图表必须有标题，正文需引用
3. **公式编号**：(章-序号) 右对齐，公式说明符号含义
4. **术语一致性**：首次出现缩写需给全称，全文统一术语
5. **参考文献**：GJB 0.1-2001 格式：作者. 题名. 报告号. 出版地: 出版者, 年份.
6. **数据呈现**：关键参数给表格，趋势给曲线图，分布给云图/等值线图
7. **结论部分**：必须呼应设计要求，逐条说明达标情况，未达标项给出原因和处理建议

注意：避免空洞表述，所有结论需有数据支撑；保留有效数字位数与精度匹配。`,
      target_agents: '["documentation"]',
      trigger_keywords: '["报告","GJB","技术报告","文档","撰写"]',
      priority: 80
    }
  ]

  for (const skill of builtinAgentSkills) {
    db.run(
      `INSERT OR IGNORE INTO agent_skills (id, name, description, content, target_agents, trigger_keywords, priority, enabled, is_builtin, is_custom)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 1, 0)`,
      [skill.id, skill.name, skill.description, skill.content, skill.target_agents, skill.trigger_keywords, skill.priority]
    )
  }
  debounceSave()
}

// 自动任务仓库
export interface AutoTask {
  id: string
  name: string
  description: string | null
  cron_expression: string
  agents: string
  is_active: number
  last_run: string | null
  next_run: string | null
  run_count: number
  result_action: string
  created_at: string
}

// 模板仓库（提示词/任务模板）
export interface Template {
  id: string
  name: string
  category: string
  description: string | null
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

// Agent 技能仓库（真正的过程性知识技能）
export interface AgentSkill {
  id: string
  name: string
  description: string | null
  content: string
  target_agents: string  // JSON 数组
  trigger_keywords: string  // JSON 数组
  priority: number
  enabled: number  // 0|1
  is_builtin: number
  is_custom: number
  created_at: string
  updated_at: string
}
