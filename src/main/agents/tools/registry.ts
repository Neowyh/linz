import type { Tool } from '@langchain/core/tools'

export type ToolSource = 'builtin' | 'mcp' | 'custom'

export interface ToolInfo {
  name: string
  description: string
  source: ToolSource
  serverId?: string
  serverName?: string
}

interface RegistryEntry {
  tool: Tool
  info: ToolInfo
}

class ToolRegistryImpl {
  private tools: Map<string, RegistryEntry> = new Map()

  register(name: string, tool: Tool, info: Omit<ToolInfo, 'name'>): void {
    this.tools.set(name, { tool, info: { name, ...info } })
  }

  unregister(name: string): void {
    this.tools.delete(name)
  }

  unregisterByServer(serverId: string): void {
    for (const key of Array.from(this.tools.keys())) {
      const entry = this.tools.get(key)
      if (entry?.info.serverId === serverId) {
        this.tools.delete(key)
      }
    }
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name)?.tool
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values()).map((e) => e.tool)
  }

  listInfos(): ToolInfo[] {
    return Array.from(this.tools.values()).map((e) => e.info)
  }

  listBySource(source: ToolSource): ToolInfo[] {
    return this.listInfos().filter((i) => i.source === source)
  }

  listByServer(serverId: string): ToolInfo[] {
    return this.listInfos().filter((i) => i.serverId === serverId)
  }

  listToolNamesByServer(serverId: string): string[] {
    return Array.from(this.tools.values())
      .filter((e) => e.info.serverId === serverId)
      .map((e) => e.info.name)
  }

  clearBySource(source: ToolSource): void {
    for (const [key, entry] of Array.from(this.tools.entries())) {
      if (entry.info.source === source) {
        this.tools.delete(key)
      }
    }
  }
}

export const toolRegistry = new ToolRegistryImpl()
