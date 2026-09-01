// 生成《临智 LINZ 产品手册》docx
const fs = require('fs')
const path = require('path')
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, ImageRun,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, VerticalAlign, PageNumber, PageBreak, TableOfContents
} = require('docx')

const SHOTS = path.join(__dirname, 'shots')
const OUT = 'E:\\lijx\\plane3d\\Design_Multi-Agent\\临智LINZ_产品手册.docx'

const PRIMARY = '1E6FCC'
const GRAY = '666666'
const IMG_W = 620
const IMG_H = Math.round(IMG_W * 1490 / 2534) // 365

// ---------- helpers ----------
const p = (text, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 300 },
  ...opts,
  children: [new TextRun({ text, ...(opts.run || {}) })]
})

const rich = (runs, opts = {}) => new Paragraph({
  spacing: { after: 120, line: 300 },
  ...opts,
  children: runs.map(r => new TextRun(r))
})

const h1 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(text)] })
const h2 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(text)] })
const h3 = (text) => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(text)] })

const bullet = (text, bold) => new Paragraph({
  numbering: { reference: 'bullets', level: 0 },
  spacing: { after: 80, line: 300 },
  children: bold
    ? [new TextRun({ text: bold, bold: true }), new TextRun({ text })]
    : [new TextRun({ text })]
})

const img = (file, caption) => [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 160, after: 80 },
    children: [new ImageRun({
      type: 'png',
      data: fs.readFileSync(path.join(SHOTS, file)),
      transformation: { width: IMG_W, height: IMG_H, rotation: 0 },
      altText: { title: caption, description: caption, name: file }
    })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 200 },
    children: [new TextRun({ text: caption, size: 18, color: GRAY, italics: true })]
  })
]

const pageBreak = () => new Paragraph({ children: [new PageBreak()] })

// 表格
const tBorder = { style: BorderStyle.SINGLE, size: 1, color: 'CCCCCC' }
const cellBorders = { top: tBorder, bottom: tBorder, left: tBorder, right: tBorder }
const mkTable = (widths, headerRow, rows) => new Table({
  columnWidths: widths,
  margins: { top: 80, bottom: 80, left: 140, right: 140 },
  rows: [
    new TableRow({
      tableHeader: true,
      children: headerRow.map((t, i) => new TableCell({
        borders: cellBorders,
        width: { size: widths[i], type: WidthType.DXA },
        shading: { fill: 'E8F2FF', type: ShadingType.CLEAR },
        verticalAlign: VerticalAlign.CENTER,
        children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: t, bold: true, size: 20 })] })]
      }))
    }),
    ...rows.map(row => new TableRow({
      children: row.map((cell, i) => new TableCell({
        borders: cellBorders,
        width: { size: widths[i], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        children: (Array.isArray(cell) ? cell : [cell]).map(txt => new Paragraph({
          children: [new TextRun({ text: txt, size: 20 })]
        }))
      }))
    }))
  ]
})

// ---------- content ----------
const children = []

// ===== 封面 =====
children.push(
  new Paragraph({ spacing: { before: 2400 } }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 200 },
    children: [new TextRun({ text: '临智 LINZ', size: 72, bold: true, color: PRIMARY })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 160 },
    children: [new TextRun({ text: '多 Agent 飞行器协同设计软件', size: 40, bold: true })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 2400 },
    children: [new TextRun({ text: '产 品 手 册', size: 32, color: GRAY })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { after: 120 },
    children: [new TextRun({ text: '对话即设计 · 为您的飞行器设计 24 小时待命', size: 24, color: GRAY, italics: true })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [new TextRun({ text: '版本 v0.1.0（Win7 兼容版）    2026 年 8 月', size: 20, color: GRAY })]
  }),
  pageBreak()
)

// ===== 目录 =====
children.push(
  new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun('目录')] }),
  new TableOfContents('Table of Contents', { hyperlink: true, headingStyleRange: '1-3' }),
  pageBreak()
)

// ===== 第一章 产品概述 =====
children.push(
  h1('第一章 产品概述'),
  h2('1.1 产品定位'),
  p('临智 LINZ 是一款面向飞行器设计工程师、研究人员及航空航天专业团队的轻量化多 Agent 协同设计桌面软件，运行于 Windows 平台（含 Windows 7 兼容版本）。'),
  p('软件以「对话即设计」为核心理念：用户通过自然语言描述飞行器设计任务，系统自动理解意图、拆解任务，并调度气动、结构、推进、航电等多个专业智能体（Agent）并行协作，覆盖从概念设计、参数估算、仿真前处理到报告输出的全流程。'),
  h2('1.2 目标用户'),
  bullet('航空航天院校研究生、博士生（飞行器设计方向）'),
  bullet('航空企业中小型设计团队（预研 / 概念阶段）'),
  bullet('无人机 / 飞行器创业团队'),
  bullet('飞行器设计独立工程师 / 顾问'),
  h2('1.3 产品架构一览'),
  p('软件采用 Electron 双进程架构，主进程内置 Agent 调度引擎、本地 SQLite 数据库、本地知识库（FTS5 全文检索 + 向量语义检索）与 MCP 工具接入层；通过 HTTPS API 调用云端大模型（DeepSeek 等），并支持 Ollama 本地模型离线备用。'),
  mkTable([2600, 6760],
    ['层级', '能力'],
    [
      ['交互层', '新建对话、自动任务、模板广场、智能体管理、本地知识库、办公室可视化六大界面'],
      ['调度层', '协调 Agent 统一拆解任务，关键词 + 语义识别专业领域，最多 3 个 Agent 并发执行，支持 Agent 间委派与结构化消息通信'],
      ['引擎层', '双引擎：pi 引擎（内置 pi-coding-agent，强工具调用）与 DeepSeek 直连引擎，故障自动降级'],
      ['工具层', '8 个内置工具（气动计算、数据分析、图表绘制、数据库查询等）+ MCP 服务器扩展（CATIA、Abaqus 等 63+ 工具）'],
      ['数据层', '本地 SQLite（对话 / 知识库 / 表格）、多工作区隔离，数据不出本机'],
      ['模型层', 'DeepSeek 云端 API 为主，Ollama 本地模型离线备用，Token 预算可控']
    ]),
  p('')
)

// ===== 第二章 产品优势 =====
children.push(
  pageBreak(),
  h1('第二章 产品优势'),
  h2('2.1 对话即设计，零门槛上手'),
  p('无需学习复杂的 CAD/CAE 软件操作，用一句自然语言即可发起设计任务。例如输入「评估 NACA 0012 翼型在低速下的气动特性，并说明结构强度关注点」，系统自动拆解为气动 + 结构两个子任务并行完成。'),
  h2('2.2 多 Agent 专业协同，而非单一聊天机器人'),
  p('内置 9 个专业 Agent（协调、气动、结构、推进、航电、仿真、文档、检索、普通对话），各有专属系统提示词、工具集与委派关系。跨领域问题由协调 Agent 自动并发调度，子 Agent 之间还能通过结构化消息多轮协商，真正模拟一个设计团队的分工协作。'),
  h2('2.3 打通真实工程软件：CATIA / Abaqus'),
  p('通过 MCP（Model Context Protocol）服务器机制，Agent 可直接调用 CATIA V5（55 个工具：建模、装配、测量、导出）与 Abaqus/CAE（8 个工具：提交作业、读 ODB、视图截图）。对话中一句话即可驱动 CATIA 完成参数化建模，AI 与工程工具链无缝衔接。'),
  h2('2.4 本地知识库增强（RAG），专业回答有据可依'),
  p('支持批量导入本地设计规范、技术报告、数据手册（PDF/Word/Excel/图片 OCR），自动构建全文 + 向量混合索引。Agent 回答前自动检索知识库并注入参考内容，设计经验持续沉淀，且全部数据仅在本机处理，不上传第三方。'),
  h2('2.5 双引擎容错，稳定可用'),
  p('内置 pi 引擎与 DeepSeek 直连双引擎：pi 引擎加载失败时自动回退 DeepSeek 路径，云端不可用时还可切换 Ollama 本地模型，配合指数退避重试与备用模型机制，最大限度保证对话链路不中断。'),
  h2('2.6 轻量化与广兼容'),
  p('基于 Electron 22 深度适配，原生兼容 Windows 7 / 10 / 11，老机器亦可流畅运行；免本地部署大模型，安装即可用。'),
  h2('2.7 成本透明可控'),
  p('月度 Token 预算 + 用量进度条 + 超阈值提醒，每次调用可视化各 Agent 消耗，让 API 成本一目了然。')
)

// ===== 第三章 快速上手 =====
children.push(
  pageBreak(),
  h1('第三章 快速上手'),
  h2('3.1 安装与启动'),
  bullet('运行安装包 linz-0.1.0-win7-setup.exe，按向导完成安装。'),
  bullet('启动后默认进入「新建对话」页，左侧为导航栏：新建对话、自动任务、模板广场、智能体管理、文档库、办公室。'),
  bullet('顶部工作区切换器支持多项目管理，每个工作区的对话、知识库、表格数据完全隔离。'),
  h2('3.2 配置大模型 API'),
  p('首次使用需配置模型 API。点击侧边栏底部「设置」，在 API 配置区选择模型供应商（默认 DeepSeek），填入 API Key 并保存。保存成功后侧边栏底部状态灯变绿（云端模式）。'),
  ...img('settings.png', '图 3-1 设置面板：API 配置、主题、Ollama 本地模型与 Token 预算'),
  bullet('备用模型：可配置 fallback 模型，主模型失败后自动切换。'),
  bullet('离线模式：启用 Ollama 本地模型后，断网环境也能继续对话（状态灯变蓝）。'),
  bullet('Token 预算：开启预算控制后，月度用量以进度条展示，超阈值自动提醒。'),
  h2('3.3 发起第一次设计任务'),
  bullet('在输入框描述设计任务，或直接点击推荐的「翼型优化分析」「总体参数估算」等任务卡片。'),
  bullet('选择调度模式（默认「普通对话」），点击发送，结果逐字流式输出。'),
  bullet('输出过程中可随时点击「终止」按钮停止生成，已输出内容保留。'),
  bullet('对话自动保存，重载软件后历史消息完整恢复。')
)

// ===== 第四章 核心功能 =====
children.push(
  pageBreak(),
  h1('第四章 核心功能详解'),
  h2('4.1 新建对话：三种调度模式'),
  p('新建对话是所有设计任务的入口。输入框下方提供三种调度模式，适应不同复杂度的任务：'),
  ...img('chat.png', '图 4-1 新建对话首页：任务输入、调度模式切换与推荐任务'),
  mkTable([2000, 7360],
    ['模式', '说明'],
    [
      ['普通对话', '由普通对话 Agent 直接回答，适合概念解释、日常问答、非专业问题'],
      ['单 Agent', '从下拉框指定一个专业 Agent（如气动 Agent）专门回答，输入 @ 可临时切换'],
      ['协同调度', '协调 Agent 自动分析问题、拆解子任务并并发调度多个专业 Agent，跨领域复杂任务推荐使用']
    ]),
  h3('4.1.1 @ 选择 Agent 与 / 注入技能'),
  bullet('输入 @ 弹出 Agent 选择器，可临时指定由哪个 Agent 回答，无需切换模式。'),
  bullet('输入 / 弹出技能选择器，将选中的技能（领域 know-how 流程）主动注入到本次对话，绕过关键词自动匹配，精确控制 Agent 按既定流程执行。'),
  h3('4.1.2 文件附件'),
  p('点击输入框附件按钮可上传 PDF / Word / Excel / CSV / DAT（翼型坐标）/ 图片等文件，解析后的内容自动注入对话上下文。例如上传翼型 DAT 文件后可直接让气动 Agent 分析其升阻特性。单文件最大 50MB。'),
  h3('4.1.3 工作空间（文件读写目录）'),
  p('点击「工作空间」按钮选择一个本地文件夹后，Agent 的文件系统工具即可在该目录内读写文件——生成外形脚本、读取结果文件、保存计算报告都在此目录下进行。未设置时文件工具处于禁用状态，保证安全。'),
  h3('4.1.4 协同调度实战：乘波体飞行器设计'),
  p('下图为协同调度模式的实际效果：用户提出「帮我设计一个乘波体飞行器」，协调 Agent 先输出任务分析（概念、可选路径、建议），再逐步展开方案。多个 Agent 输出以各自颜色与徽标区分，交错流式呈现。'),
  ...img('conv-waverider.png', '图 4-2 协同调度：乘波体飞行器设计任务的分析与展开'),
  h3('4.1.5 结果导出'),
  p('任意对话可一键导出为 Markdown / Word / PDF：Word 导出保留标题、表格、公式（LaTeX）与代码块格式；Markdown 导出自动打包对话中的图表图片，便于归档与汇报。')
)

// ===== 4.2 智能体管理 =====
children.push(
  pageBreak(),
  h2('4.2 智能体管理'),
  p('「智能体管理」页集中管理全部 Agent、MCP 服务器、工具与技能，包含四个标签页。'),
  ...img('agents.png', '图 4-3 Agent 列表：9 个内置 Agent + 自定义 Agent'),
  h3('4.2.1 Agent 列表'),
  p('内置 9 个专业 Agent，各司其职，卡片上标注了委派关系标签（如气动 Agent 可委派仿真、检索 Agent 协助）：'),
  mkTable([2200, 4360, 2800],
    ['Agent', '核心职责', '可委派对象'],
    [
      ['协调 Agent', '任务拆解、Agent 调度、结果汇总', '全部 Agent'],
      ['气动 Agent', '气动分析、翼型评估、升阻计算、CFD 前处理', '仿真 / 检索'],
      ['结构 Agent', '结构设计、强度刚度估算、材料选型', '仿真 / 检索'],
      ['推进 Agent', '发动机选型、推力分析、燃油系统', '检索'],
      ['航电 Agent', '飞控架构、传感器、通信导航、电气系统', '检索'],
      ['仿真 Agent', 'CFD/FEM 仿真预处理、求解器设置、结果解读', '气动 / 检索'],
      ['文档 Agent', '技术报告、GJB 文档、设计评审材料', '检索'],
      ['检索 Agent', '知识库检索、文献调研、标准规范', '—'],
      ['普通对话', '通用问答、概念解释、跨域引导', '检索']
    ]),
  h3('4.2.2 自定义与编辑 Agent'),
  p('点击「创建 Agent」可定义全新 Agent（名称、描述、颜色、图标、系统提示词、工具、关键词、委派关系、子任务前缀、引擎与模型），创建后自动出现在协调 Agent 的调度视野中，无需重启。内置 Agent 同样可编辑，且支持「重置为默认」一键还原。'),
  ...img('agent-editor.png', '图 4-4 Agent 编辑器：定制角色、提示词、工具与委派关系'),
  p('每个 Agent 可选择执行引擎：pi 引擎（强工具调用能力）或 DeepSeek 直连引擎，按需为不同 Agent 搭配不同引擎与模型。'),
  h3('4.2.3 MCP 服务器：接入 CATIA / Abaqus'),
  p('MCP（Model Context Protocol）服务器是外部工具源，连接后其工具可在 Agent 编辑器中勾选使用。软件内置 CATIA V5 与 Abaqus 服务器模板，支持一键探测本机服务路径、连接测试与启停管理；也可添加任意自定义 MCP 服务器（stdio / Python）。'),
  ...img('agents-mcp.png', '图 4-5 MCP 服务器管理：CATIA V5（55 工具）与 Abaqus（8 工具）已连接'),
  p('连接 CATIA 后，对话中即可直接驱动 CAD 建模。下图为实际对话：Agent 依次调用草图、拉伸等工具创建圆柱体零件，并返回模型概要表格。'),
  ...img('conv-catia.png', '图 4-6 对话驱动 CATIA：一句话完成参数化建模'),
  h3('4.2.4 工具总览'),
  p('「工具总览」汇总当前全部可用工具：8 个内置工具 + 各 MCP 服务器工具（图示共 71 个），支持按名称/描述搜索，便于了解 Agent 的能力边界。'),
  ...img('agents-tools.png', '图 4-7 工具总览：内置工具与 MCP 工具统一检索'),
  mkTable([2400, 6960],
    ['内置工具', '功能'],
    [
      ['calculator', '通用数学表达式安全计算'],
      ['aero_calculator', '气动公式计算（升力/阻力/雷诺数/马赫数/动压/升阻比/翼载）'],
      ['knowledge_search', '本地知识库检索'],
      ['db_tables / db_query', '列出已导入数据表结构 / 对表格执行只读 SQL 查询'],
      ['python', '执行内嵌 Python（numpy/matplotlib/scipy/pandas 及 docx/pdf/xlsx 技能依赖）完成计算与可视化'],
      ['node', '执行内联 JavaScript（内置 docx/pptxgenjs 库），生成 Word/PPT 文档'],
      ['run_skill_script', '执行技能附带脚本（.py/.js/.bat，执行前弹窗确认）']
    ]),
  h3('4.2.5 技能：可复用的领域 Know-How'),
  p('技能是「过程性知识」：当 Agent 命中触发关键词时，技能内容自动注入其系统提示词，告诉它「遇到 X 该怎么做」。技能支持优先级、启用开关、导入 / 导出（.zip 技能包，可附带脚本文件），方便团队间共享设计流程。'),
  ...img('agents-skills.png', '图 4-8 技能管理：内置技能与导入的第三方技能'),
  ...img('skill-editor.png', '图 4-9 创建技能：定义触发关键词、目标 Agent 与执行流程')
)

// ===== 4.3 模板广场 =====
children.push(
  pageBreak(),
  h2('4.3 模板广场'),
  p('模板广场沉淀了飞行器设计全流程的常用任务模板，按气动分析、总体设计、推进设计、结构强度、文档输出、航电控制分类。每个模板是预置好提示词与关联 Agent 的任务起点，点击「使用」即带着模板进入对话，按提示填写参数即可。'),
  ...img('templates.png', '图 4-10 模板广场：内置飞行器设计任务模板'),
  p('内置模板包括：GJB 格式技术报告生成、NACA 翼型全套分析、总体参数快速估算、推进系统匹配计算、机翼结构初步设计、多段翼增升装置设计、CFD 前处理建议、航电系统方案设计等。'),
  p('点击「创建模板」可将团队的设计流程固化为自定义模板，支持 {{变量名}} 占位符——使用模板时自动提示填写对应参数。'),
  ...img('template-editor.png', '图 4-11 创建自定义模板：变量占位符自动识别')
)

// ===== 4.4 知识库 =====
children.push(
  pageBreak(),
  h2('4.4 本地知识库'),
  p('本地知识库将设计规范、技术报告、数据手册等本地文档索引为可检索的知识资产，供 Agent 回答时精准引用（RAG 增强）。'),
  ...img('knowledge.png', '图 4-12 文档库：分类浏览、标签过滤与全文搜索'),
  h3('4.4.1 文档导入与索引'),
  bullet('支持单个文件或整个文件夹批量导入，导入进度实时显示，失败文件单独列明原因。'),
  bullet('支持格式：PDF、Word、Excel、CSV、TXT/Markdown，图片（PNG/JPG）经 OCR 识别文字后入库。'),
  bullet('导入时可指定领域分类（总体设计/气动分析/结构强度/推进设计/航电控制/标准规范等）与自定义标签，便于后续过滤检索。'),
  bullet('索引采用 better-sqlite3 + FTS5 全文索引，中文关键词毫秒级命中；可选本地向量模型生成 embedding，实现语义检索，模型不可用时自动回退关键词检索。'),
  h3('4.4.2 检索与问答'),
  bullet('搜索框支持关键词检索（至少 2 个字），可按标签过滤；命中结果标注来源文档与相关度。'),
  bullet('「向知识库提问」直接基于库内文档生成带引用的回答。'),
  bullet('对话中的 Agent 会自动检索知识库，将相关内容以「知识库参考」注入回答，无需手动操作。'),
  bullet('支持文档标签/领域修改、单个删除与批量删除，知识库体积、文档数、文本块数实时统计。'),
  h3('4.4.3 数据表格（数据库）'),
  p('「数据库」标签页管理导入的结构化数据表（xlsx/csv）。导入后可直接预览数据，Agent 通过 db_tables / db_query 工具用 SQL 查询这些表格，并用 python 绘制图表——下图为查询屈曲试验数据库并可视化散点分布的实际对话。'),
  ...img('conv-table-chart.png', '图 4-13 表格查询与可视化：从数据库筛选屈曲值并绘制散点图')
)

// ===== 4.5 自动任务 =====
children.push(
  pageBreak(),
  h2('4.5 自动任务'),
  p('自动任务用于创建定时 / 周期性的设计辅助任务，到点自动调用 Agent 执行，结果通过系统通知推送并保存为「[自动]」前缀的对话记录。'),
  ...img('auto-tasks.png', '图 4-14 自动任务：任务列表与推荐模板'),
  bullet('灵活周期：每小时 / 每天 / 每周 / 自定义 cron 表达式，可指定执行时间与执行日。'),
  bullet('指定 Agent：创建时勾选参与执行的 Agent（如协调 + 文档 Agent 生成进度报告）。'),
  bullet('测试运行：每个任务提供「测试」按钮，立即手动触发一次验证效果。'),
  bullet('推荐模板：每日设计进度报告、气动参数变化监控、航空文献更新追踪、每日设计日志，一键添加。'),
  p('提示：自动任务依赖软件常驻运行，软件关闭到系统托盘后调度依然生效。')
)

// ===== 4.6 办公室 =====
children.push(
  pageBreak(),
  h2('4.6 办公室：Agent 状态可视化'),
  p('办公室页面以拟人化 3D 场景实时展示所有 Agent 的工作状态：哪个 Agent 正在思考、哪个正在计算、哪个待命，一目了然；多 Agent 协同时，正在通信的 Agent 工位会高亮并显示「通信中」徽章。'),
  ...img('office.png', '图 4-15 办公室：Agent 工位实时状态与通信频道'),
  bullet('在岗 Agent 面板：列出全部 Agent 及其当前状态，支持搜索。'),
  bullet('Agent 通信频道：时间序列展示 Agent 间的结构化消息（请求/结果/状态），含置信度与内容详情，多轮协商过程完全透明。'),
  bullet('对话明细：今日 Token 消耗、进行中/已完成任务统计，每条对话的累计 Token 消耗清晰可查。')
)

// ===== 4.7 其他 =====
children.push(
  pageBreak(),
  h2('4.7 更多实用能力'),
  h3('4.7.1 多工作区'),
  p('侧边栏顶部的工作区切换器支持创建多个项目工作区，每个工作区拥有独立的对话记录、知识库与表格数据库，切换后页面自动刷新。适合按型号 / 项目隔离管理设计数据。'),
  h3('4.7.2 深色主题'),
  p('设置中提供亮色 / 深色 / 跟随系统三种主题模式，全界面（含 Ant Design 组件）自动适配。'),
  h3('4.7.3 系统托盘常驻'),
  p('关闭窗口后软件最小化到系统托盘继续运行，自动任务调度不中断；双击托盘图标恢复窗口，右键菜单可直接退出。'),
  h3('4.7.4 内置终端与侧边浏览器'),
  p('软件内置终端面板（基于 node-pty），可直接执行命令行操作；侧边浏览器面板支持在应用内查阅网页资料，与对话、知识库联动，无需来回切换窗口。')
)

// ===== 第五章 场景 =====
children.push(
  pageBreak(),
  h1('第五章 典型应用场景'),
  h2('5.1 翼型气动分析'),
  p('输入「根据 NACA 2412 翼型参数，分析巡航马赫数 0.3 下的升阻比」→ 气动 Agent 调用 aero_calculator 完成升阻估算，结合知识库中的翼型数据给出分析结论，python 绘制升阻极曲线。'),
  h2('5.2 跨专业协同设计'),
  p('输入「评估某翼型气动与结构耦合」→ 协调 Agent 拆解任务，气动 Agent 与结构 Agent 并发工作，互相通过消息传递气动载荷与强度校核结果，最后汇总为一致性结论。'),
  h2('5.3 对话驱动 CAD 建模'),
  p('连接 CATIA MCP 服务器后，输入「创建一个半径 50mm、高 200mm 的圆柱体零件」→ Agent 依次调用草图、拉伸工具完成建模，返回模型概要；可继续追加「打孔」「导出 STEP」等指令。'),
  h2('5.4 试验数据分析'),
  p('将试验数据 xlsx 导入「数据库」→ 输入「列出屈曲值大于 1 的数据并可视化」→ Agent 执行 SQL 筛选、统计分析并绘制散点图，附统计汇总表。'),
  h2('5.5 规范符合性审查'),
  p('将 GJB、国标等规范文档批量导入知识库 → 输入「调压器未进行防腐处理，是否符合要求」→ Agent 检索相关条款并给出带出处的符合性判断。'),
  h2('5.6 技术报告自动生成'),
  p('使用「GJB 格式技术报告生成」模板 → 文档 Agent 汇总当前设计结果，按 GJB 格式生成报告，一键导出 Word 提交评审。')
)

// ===== 附录 =====
children.push(
  pageBreak(),
  h1('附录'),
  h2('附录 A 运行环境'),
  mkTable([3120, 6240],
    ['项目', '要求'],
    [
      ['操作系统', 'Windows 7 SP1 / 10 / 11（64 位）'],
      ['网络', '云端模式需访问 api.deepseek.com；Ollama 离线模式可断网使用'],
      ['API Key', 'DeepSeek API Key（云端模式必需）'],
      ['可选组件', 'Ollama（离线模型）、CATIA V5 / Abaqus（MCP 工具联动）、Python（自定义 MCP 服务器与技能脚本）']
    ]),
  h2('附录 B 数据与安全'),
  bullet('全部对话、知识库、表格数据存储于本机（用户目录下的工作区数据库），不上传任何第三方服务器。'),
  bullet('仅对话文本经 HTTPS 发送至所配置的大模型 API；知识库原文不随检索外发。'),
  bullet('Agent 文件工具仅在用户显式设置的工作空间目录内读写，越权访问被拒绝。'),
  bullet('技能脚本执行前弹窗展示完整命令行，需用户确认后方可运行。'),
  h2('附录 C 常见问题'),
  rich([{ text: 'Q：发送消息后一直无响应？', bold: true }, { text: '检查设置中的 API Key 是否保存成功（状态灯应为绿色）；确认网络可访问 api.deepseek.com；或尝试启用 Ollama 离线模式。' }]),
  rich([{ text: 'Q：知识库搜不到刚上传的文档？', bold: true }, { text: '确认文档状态为「已索引」；向量模型未就绪时会自动回退关键词检索，中文关键词请输入至少 2 个字。' }]),
  rich([{ text: 'Q：协同调度只来了一个 Agent？', bold: true }, { text: '调度依赖专业关键词匹配，可在提问中明确领域词（如「气动」「结构」），或用 @ 直接指定 Agent。' }]),
  rich([{ text: 'Q：CATIA 工具调用失败？', bold: true }, { text: '在「智能体管理 → MCP 服务器」检查 CATIA 服务器连接状态，使用「探测」自动定位服务路径后重新连接。' }]),
  p(''),
  new Paragraph({
    alignment: AlignmentType.CENTER, spacing: { before: 600 },
    children: [new TextRun({ text: '临智 LINZ —— 让每位飞行器工程师都有一个不知疲倦的 AI 设计团队', size: 20, color: GRAY, italics: true })]
  })
)

// ---------- document ----------
const doc = new Document({
  styles: {
    default: { document: { run: { font: 'Microsoft YaHei', size: 21 } } },
    paragraphStyles: [
      { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 32, bold: true, color: PRIMARY, font: 'Microsoft YaHei' },
        paragraph: { spacing: { before: 320, after: 200 }, outlineLevel: 0 } },
      { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 27, bold: true, color: '1D1D1F', font: 'Microsoft YaHei' },
        paragraph: { spacing: { before: 240, after: 160 }, outlineLevel: 1 } },
      { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { size: 23, bold: true, color: '333333', font: 'Microsoft YaHei' },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } }
    ]
  },
  numbering: {
    config: [
      { reference: 'bullets', levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT,
        style: { paragraph: { indent: { left: 520, hanging: 260 } } } }] }
    ]
  },
  sections: [{
    properties: { page: { margin: { top: 1200, right: 1200, bottom: 1200, left: 1200 } } },
    headers: {
      default: new Header({ children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        children: [new TextRun({ text: '临智 LINZ 产品手册', size: 16, color: '999999' })]
      })] })
    },
    footers: {
      default: new Footer({ children: [new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new TextRun({ text: '第 ', size: 16, color: '999999' }),
          new TextRun({ children: [PageNumber.CURRENT], size: 16, color: '999999' }),
          new TextRun({ text: ' 页 / 共 ', size: 16, color: '999999' }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], size: 16, color: '999999' }),
          new TextRun({ text: ' 页', size: 16, color: '999999' })
        ]
      })] })
    },
    children
  }]
})

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync(OUT, buf)
  console.log('手册已生成:', OUT, (buf.length / 1024).toFixed(0) + 'KB')
})
