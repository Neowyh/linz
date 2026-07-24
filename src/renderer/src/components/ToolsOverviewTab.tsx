import { useState, useEffect, useMemo } from 'react'
import { Input, Empty, Tag, Spin } from 'antd'
import { SearchOutlined } from '@ant-design/icons'
import { useCustomAgentStore } from '../stores/customAgentStore'
import type { ToolInfo } from '../types/customAgent'

export default function ToolsOverviewTab(): JSX.Element {
  const { availableTools, fetchAvailableTools } = useCustomAgentStore()
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')

  useEffect(() => {
    setLoading(true)
    fetchAvailableTools().finally(() => setLoading(false))
  }, [fetchAvailableTools])

  // 按 source 分组（内置工具 / 各 MCP 服务器）
  const groups = useMemo(() => {
    const filtered = availableTools.filter((t) => {
      if (!search.trim()) return true
      const q = search.toLowerCase()
      return (
        t.name.toLowerCase().includes(q) ||
        (t.description || '').toLowerCase().includes(q) ||
        (t.serverName || '').toLowerCase().includes(q)
      )
    })

    const byKey: Record<string, { title: string; source: string; tools: ToolInfo[] }> = {}
    for (const tool of filtered) {
      const source = tool.source || 'builtin'
      const key = source === 'mcp' ? `mcp:${tool.serverId}` : source
      const title = source === 'mcp' ? `MCP 服务器: ${tool.serverName || tool.serverId}` : '内置工具'
      if (!byKey[key]) {
        byKey[key] = { title, source, tools: [] }
      }
      byKey[key].tools.push(tool)
    }
    return Object.values(byKey).sort((a, b) => {
      // 内置工具组在前，MCP 组按名称排序
      if (a.source === 'builtin' && b.source !== 'builtin') return -1
      if (a.source !== 'builtin' && b.source === 'builtin') return 1
      return a.title.localeCompare(b.title)
    })
  }, [availableTools, search])

  const totalCount = availableTools.length
  const mcpCount = availableTools.filter((t) => t.source === 'mcp').length
  const builtinCount = totalCount - mcpCount

  return (
    <div className="h-full">
      <div className="flex items-center justify-between mb-4">
        <div className="text-sm text-gray-600">
          共 {totalCount} 个工具（内置 {builtinCount} + MCP {mcpCount}）
        </div>
        <Input
          prefix={<SearchOutlined />}
          placeholder="搜索工具名/描述/服务器"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-72"
          allowClear
        />
      </div>

      {loading ? (
        <div className="text-center py-8">
          <Spin />
        </div>
      ) : groups.length === 0 ? (
        <Empty description={search ? '未找到匹配的工具' : '尚未注册任何工具'} />
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.title} className="bg-white rounded-card border border-gray-100 p-4 shadow-sm">
              <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <h4 className="text-sm font-medium text-gray-900 m-0">{group.title}</h4>
                  <Tag>{group.tools.length}</Tag>
                </div>
                <Tag color={group.source === 'builtin' ? 'gold' : 'green'}>
                  {group.source === 'builtin' ? '内置' : 'MCP'}
                </Tag>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {group.tools.map((tool) => (
                  <div
                    key={tool.name}
                    className="p-2 border border-gray-100 rounded hover:border-blue-300 hover:bg-blue-50 transition-colors"
                  >
                    <div className="text-xs font-mono text-blue-600 break-all">{tool.name}</div>
                    <div className="text-xs text-gray-600 mt-1 line-clamp-2 min-h-[2em]">
                      {tool.description || '（无描述）'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
