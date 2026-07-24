import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import path from 'path'
import os from 'os'

const execFileAsync = promisify(execFile)

export interface McpTemplate {
  id: string
  name: string
  description: string
  icon: string
  transport: 'stdio' | 'http' | 'sse'
  command?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  url?: string
}

// 默认 CATIA MCP 服务器路径（开发期硬编码，用户可在表单中修改）
const DEFAULT_CATIA_SERVER_PATH = 'E:\\lijx\\plane3d\\3D_software_mcp\\catia-v5-mcp-server'

// 默认 Abaqus MCP 服务器路径（仓库克隆到此，用户可在表单中修改）
const DEFAULT_ABAQUS_SERVER_PATH = 'E:\\lijx\\plane3d\\3D_software_mcp\\abaqus-mcp'

export const MCP_TEMPLATES: McpTemplate[] = [
  {
    id: 'template-catia',
    name: 'CATIA V5',
    description: 'CATIA V5 CAD 自动化（54 工具：文档/草图/零件/装配/测量/导出）',
    icon: 'assets/icons/structural.svg',
    transport: 'stdio',
    command: '',  // 用户填或点击"检测 Python"自动填充
    args: ['-m', 'catia_mcp'],
    cwd: '',  // 用户填或自动检测
    env: { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
  },
  {
    id: 'template-abaqus',
    name: 'Abaqus',
    description: 'Abaqus/CAE 有限元仿真自动化（8 工具：执行脚本/模型信息/作业管理/ODB 检视/视口截图）',
    icon: 'assets/icons/simulation.svg',
    transport: 'stdio',
    command: '',  // 用户填或点击"检测 Python"自动填充
    args: [`${DEFAULT_ABAQUS_SERVER_PATH}\\mcp_server.py`],  // mcp_server.py 脚本路径，可点击"检测 Abaqus 路径"重填
    cwd: DEFAULT_ABAQUS_SERVER_PATH,
    env: { PYTHONUNBUFFERED: '1', PYTHONIOENCODING: 'utf-8' }
  }
]

// 检测系统 Python 可执行文件路径，依次尝试 where python / where py / 常见安装路径
export async function detectPythonPath(): Promise<string | null> {
  // 1. 尝试 where python (Windows) / which python (Unix)
  const whereCmd = os.platform() === 'win32' ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(whereCmd, ['python'])
    const found = stdout.trim().split('\n')[0].trim()
    if (found && await isExecutable(found)) return found
  } catch {
    // not in PATH
  }

  // 2. 尝试 where py (Windows Python launcher)
  if (os.platform() === 'win32') {
    try {
      const { stdout } = await execFileAsync('where', ['py'])
      const found = stdout.trim().split('\n')[0].trim()
      if (found && await isExecutable(found)) return found
    } catch {
      // py launcher not installed
    }
  }

  // 3. 检查常见安装路径（Windows）
  if (os.platform() === 'win32') {
    const candidates: string[] = []
    const localAppData = process.env.LOCALAPPDATA
    if (localAppData) {
      // Microsoft Store 版本: %LOCALAPPDATA%\Microsoft\WindowsApps\python.exe
      candidates.push(path.join(localAppData, 'Microsoft', 'WindowsApps', 'python.exe'))
      // python.org 安装: %LOCALAPPDATA%\Programs\Python\Python3x\python.exe
      const programsDir = path.join(localAppData, 'Programs', 'Python')
      try {
        const entries = await fs.promises.readdir(programsDir)
        for (const entry of entries) {
          if (entry.toLowerCase().startsWith('python3')) {
            candidates.push(path.join(programsDir, entry, 'python.exe'))
          }
        }
      } catch {
        // dir not found
      }
    }
    // C:\Python3x\
    try {
      const rootEntries = await fs.promises.readdir('C:\\')
      for (const entry of rootEntries) {
        if (/^python3\d*$/i.test(entry)) {
          candidates.push(path.join('C:\\', entry, 'python.exe'))
        }
      }
    } catch {
      // permission denied or not exists
    }

    for (const candidate of candidates) {
      if (await isExecutable(candidate)) return candidate
    }
  }

  return null
}

async function isExecutable(filePath: string): Promise<boolean> {
  try {
    await fs.promises.access(filePath, fs.constants.X_OK)
    return true
  } catch {
    return false
  }
}

// 检测 CATIA MCP 服务器项目根目录
export async function detectCatiaServerPath(): Promise<string | null> {
  // 1. 检查默认开发期路径
  try {
    await fs.promises.access(DEFAULT_CATIA_SERVER_PATH, fs.constants.F_OK)
    return DEFAULT_CATIA_SERVER_PATH
  } catch {
    // not at default path
  }

  // 2. 未来可扩展：从配置文件读用户自定义路径
  return null
}

// 检测 CATIA 服务器目录下是否存在 catia_mcp 模块（用于校验 cwd 是否正确）
export async function validateCatiaServerPath(cwd: string): Promise<boolean> {
  try {
    const modulePath = path.join(cwd, 'catia_mcp')
    await fs.promises.access(modulePath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}

// 检测 Abaqus MCP 服务器项目根目录
export async function detectAbaqusServerPath(): Promise<string | null> {
  try {
    await fs.promises.access(DEFAULT_ABAQUS_SERVER_PATH, fs.constants.F_OK)
    return DEFAULT_ABAQUS_SERVER_PATH
  } catch {
    return null
  }
}

// 检测 Abaqus 服务器目录下是否存在 mcp_server.py（用于校验路径是否正确）
export async function validateAbaqusServerPath(cwd: string): Promise<boolean> {
  try {
    const scriptPath = path.join(cwd, 'mcp_server.py')
    await fs.promises.access(scriptPath, fs.constants.F_OK)
    return true
  } catch {
    return false
  }
}
