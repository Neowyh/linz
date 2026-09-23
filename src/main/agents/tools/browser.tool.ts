// browser 工具：让大模型直接操作应用内嵌的侧边栏浏览器（Dock 浏览器面板的 <webview>）。
// 动作原语在 browser-session.ts 中执行（主进程直接驱动 guest WebContents），
// 本文件只负责 LangChain 工具外观：名称、面向模型的中文描述、Zod 参数 schema。
//
// 安全设计：
// - 无 execute_js 原始 JS 参数，唯一代码路径是 browser-session 里的固定片段，无注入面
// - navigate 仅允许 http/https（主进程正则 + 渲染端 normalizeUrl/will-navigate 双重拦截）
// - 风险等级 network → 默认 ask → DeepSeek 路径自动弹对话内审批卡（security-policy.ts）

import { DynamicStructuredTool } from '@langchain/core/tools'
import type { Tool } from '@langchain/core/tools'
import type { RunnableConfig } from '@langchain/core/runnables'
import { z } from 'zod'
import { executeBrowserAction, type BrowserActionParams } from '../../browser/browser-session'

export const browserTool = new DynamicStructuredTool({
  name: 'browser',
  description:
    '操作应用内嵌的侧边栏浏览器（界面右侧的浏览器面板），可导航网页、点击、输入、滚动、截图、读取页面内容，' +
    '用于需要访问真实网页完成的任务（查资料、填表单、看网页界面等）。' +
    '动作列表：navigate 打开网页（参数 url，仅支持 http/https）；' +
    'getInteractiveElements 列出当前页面可交互元素并打编号（返回 [编号] 元素说明 清单，推荐操作前先调用）；' +
    'click 点击元素（参数 ref 元素编号【推荐】 或 selector CSS 选择器）；' +
    'type 在输入框输入文本（参数 ref 或 selector + text）；' +
    'scroll 滚动页面（参数 deltaY 像素，或给 ref/selector 滚动到该元素）；' +
    'back / forward / reload 后退 / 前进 / 刷新；screenshot 截图（结果直接以图片显示在对话中）；' +
    'read 读取当前页面的标题、网址和正文文本；wait 等待元素出现（参数 ref 或 selector + timeoutMs）。' +
    '操作作用于浏览器当前激活的标签页，首次调用会自动打开浏览器面板。' +
    '\n\n【重要操作纪律】强烈建议：操作前先 getInteractiveElements 拿到当前页面元素编号清单，再用 ref 编号操作（如 click({ref:3})），比手写 CSS selector 更准。' +
    '注意：ref 编号是快照，页面任何刷新/导航/重渲染（含 click 触发跳转）后旧编号作废，必须重新 getInteractiveElements。' +
    '找不到目标元素时先 scroll 滚动后重新 getInteractiveElements 再操作。' +
    'click/type/scroll/wait 作用于页面主框架文档，无法操作跨域 iframe 内部元素；' +
    '元素不存在或编号失效会返回错误提示（含"重新 getInteractiveElements"提示），据此调整后重试；页面未加载完时可用 wait 等待元素出现。',
  schema: z.object({
    action: z
      .enum(['navigate', 'getInteractiveElements', 'click', 'type', 'scroll', 'back', 'forward', 'reload', 'screenshot', 'read', 'wait'])
      .describe('要执行的操作'),
    url: z.string().optional().describe('navigate 的目标网址，仅支持 http/https'),
    ref: z
      .number()
      .int()
      .positive()
      .optional()
      .describe('getInteractiveElements 返回的元素编号，click/type/wait/scroll 可用它定位元素（推荐，比手写 selector 准）。页面刷新/导航后失效，需重新 getInteractiveElements'),
    selector: z
      .string()
      .optional()
      .describe('CSS 选择器（click/type/scroll 到元素/wait 使用，如 #search-input、input[name=q]、button[type=submit]）；优先级低于 ref，仅在不用编号时使用'),
    text: z.string().optional().describe('type 时要输入的文本'),
    deltaY: z.number().optional().describe('scroll 垂直滚动像素（正数向下，默认 600；提供 ref/selector 时改为滚动到该元素）'),
    timeoutMs: z.number().optional().describe('wait 的等待超时毫秒数（默认 10000，最大 30000）')
  }),
  func: async (input: BrowserActionParams, _runManager?: unknown, config?: RunnableConfig): Promise<string> => {
    try {
      return await executeBrowserAction(input, config?.signal)
    } catch (err: any) {
      return `❌ 浏览器操作出错: ${err?.message || String(err)}`
    }
  }
}) as unknown as Tool
