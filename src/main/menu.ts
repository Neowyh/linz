import { app, BrowserWindow, Menu, dialog, type MenuItemConstructorOptions } from 'electron'

export type MenuAction =
  | 'new-conversation'
  | 'close-conversation'
  | 'export-markdown'
  | 'export-word'
  | 'export-pdf'
  | 'search-focus'
  | 'theme'
  | 'right-panel-toggle'
  | 'left-panel-toggle'
  | 'right-panel-tab'
  | 'open-panel'
  | 'navigate'

export interface MenuActionPayload {
  action: MenuAction
  payload?: unknown
}

export function sendMenuAction(win: BrowserWindow | null, action: MenuAction, payload?: unknown): void {
  if (!win || win.isDestroyed()) return
  win.webContents.send('menu:action', { action, payload } satisfies MenuActionPayload)
}

function getMainWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
}

export function setupAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件(&F)',
      submenu: [
        {
          label: '新建对话',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuAction(getMainWindow(), 'new-conversation')
        },
        {
          label: '关闭当前对话',
          accelerator: 'CmdOrCtrl+W',
          click: () => sendMenuAction(getMainWindow(), 'close-conversation')
        },
        { type: 'separator' },
        {
          label: '导出对话',
          submenu: [
            {
              label: '导出为 Markdown',
              click: () => sendMenuAction(getMainWindow(), 'export-markdown')
            },
            {
              label: '导出为 Word (.docx)',
              click: () => sendMenuAction(getMainWindow(), 'export-word')
            },
            {
              label: '导出为 PDF',
              click: () => sendMenuAction(getMainWindow(), 'export-pdf')
            }
          ]
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: 'CmdOrCtrl+Q',
          role: 'quit'
        }
      ]
    },
    {
      label: '编辑(&E)',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        {
          label: '搜索对话',
          accelerator: 'CmdOrCtrl+F',
          click: () => sendMenuAction(getMainWindow(), 'search-focus')
        }
      ]
    },
    {
      label: '视图(&V)',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '强制刷新', accelerator: 'CmdOrCtrl+Shift+R', role: 'forceReload' },
        { type: 'separator' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '实际大小', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' },
        { type: 'separator' },
        { label: '切换全屏', accelerator: 'F11', role: 'togglefullscreen' },
        { type: 'separator' },
        {
          label: '主题',
          submenu: [
            {
              label: '亮色',
              click: () => sendMenuAction(getMainWindow(), 'theme', 'light')
            },
            {
              label: '深色',
              click: () => sendMenuAction(getMainWindow(), 'theme', 'dark')
            },
            {
              label: '跟随系统',
              click: () => sendMenuAction(getMainWindow(), 'theme', 'system')
            }
          ]
        },
        {
          label: '工作区面板',
          submenu: [
            {
              label: '显示 / 隐藏面板',
              accelerator: 'CmdOrCtrl+B',
              click: () => sendMenuAction(getMainWindow(), 'right-panel-toggle')
            },
            { type: 'separator' },
            {
              label: '打开浏览器面板',
              click: () => sendMenuAction(getMainWindow(), 'right-panel-tab', 'browser')
            },
            {
              label: '打开终端面板',
              click: () => sendMenuAction(getMainWindow(), 'right-panel-tab', 'terminal')
            },
            {
              label: '打开文件面板',
              click: () => sendMenuAction(getMainWindow(), 'right-panel-tab', 'files')
            },
            { type: 'separator' },
            {
              label: '打开知识库面板',
              click: () => sendMenuAction(getMainWindow(), 'open-panel', 'kb')
            },
            {
              label: '打开三维模型面板',
              click: () => sendMenuAction(getMainWindow(), 'open-panel', 'viewer3d')
            },
            {
              label: '打开仿真结果面板',
              click: () => sendMenuAction(getMainWindow(), 'open-panel', 'field')
            }
          ]
        },
        {
          label: '左侧面板',
          submenu: [
            {
              label: '显示 / 隐藏面板',
              accelerator: 'CmdOrCtrl+Shift+B',
              click: () => sendMenuAction(getMainWindow(), 'left-panel-toggle')
            }
          ]
        },
        { type: 'separator' },
        {
          label: '开发者工具',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => {
            const win = getMainWindow()
            if (win) win.webContents.toggleDevTools()
          }
        }
      ]
    },
    {
      label: '导航(&N)',
      submenu: [
        { label: '对话', click: () => sendMenuAction(getMainWindow(), 'navigate', '/chat') },
        { label: '办公室', click: () => sendMenuAction(getMainWindow(), 'navigate', '/office') },
        { label: '自动任务', click: () => sendMenuAction(getMainWindow(), 'navigate', '/auto-tasks') },
        { label: '模板广场', click: () => sendMenuAction(getMainWindow(), 'navigate', '/templates') },
        { label: '智能体管理', click: () => sendMenuAction(getMainWindow(), 'navigate', '/agents') },
        { label: '文档库', click: () => sendMenuAction(getMainWindow(), 'navigate', '/knowledge') }
      ]
    },
    {
      label: '窗口(&W)',
      submenu: [
        {
          label: '最小化',
          accelerator: 'CmdOrCtrl+M',
          click: () => getMainWindow()?.minimize()
        },
        {
          label: '最大化 / 还原',
          click: () => {
            const win = getMainWindow()
            if (!win) return
            if (win.isMaximized()) {
              win.unmaximize()
            } else {
              win.maximize()
            }
          }
        },
        { label: '关闭窗口', role: 'close' }
      ]
    },
    {
      label: '帮助(&H)',
      submenu: [
        {
          label: '关于临智 LINZ',
          click: () => {
            const win = getMainWindow()
            const opts = {
              type: 'info' as const,
              title: '关于临智 LINZ',
              message: '临智 LINZ',
              detail:
                `版本: ${app.getVersion()}\n\n` +
                '对话即设计 —— 面向飞行器设计工程师的轻量级多 Agent 协同设计桌面软件。\n\n' +
                '由多个专业 AI 智能体协作完成飞机设计任务：\n' +
                '总体设计 · 结构强度 · 动力推进 · 航电系统 · 仿真分析 · 文档编制'
            }
            if (win) {
              dialog.showMessageBox(win, opts)
            } else {
              dialog.showMessageBox(opts)
            }
          }
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
