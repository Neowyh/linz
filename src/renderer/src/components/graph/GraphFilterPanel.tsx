import { useMemo } from 'react'
import { Checkbox, Slider, Switch, Tag } from 'antd'
import { useKnowledgeGraphStore } from '../../stores/knowledgeGraphStore'

export default function GraphFilterPanel(): JSX.Element {
  const graph = useKnowledgeGraphStore((s) => s.graph)
  const filters = useKnowledgeGraphStore((s) => s.filters)
  const setFilters = useKnowledgeGraphStore((s) => s.setFilters)

  // 从图数据提取所有分类与标签
  const { categories, tags } = useMemo(() => {
    const cats = new Set<string>()
    const tagSet = new Set<string>()
    for (const n of graph?.nodes || []) {
      if (n.kind !== 'document') continue
      if (n.category) cats.add(n.category)
      for (const t of n.tags || []) tagSet.add(t)
    }
    return { categories: Array.from(cats), tags: Array.from(tagSet).slice(0, 30) }
  }, [graph])

  const toggleInList = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value]

  return (
    <div className="w-52 flex-shrink-0 space-y-4 pr-3 border-r border-line-light overflow-y-auto">
      <div>
        <div className="text-xs font-medium text-gray-700 mb-2">相似度阈值</div>
        <Slider
          min={0.05}
          max={0.9}
          step={0.05}
          value={filters.threshold}
          onChange={(v) => setFilters({ threshold: v })}
          tooltip={{ formatter: (v) => `≥ ${v}` }}
        />
        <div className="text-[10px] text-gray-400 -mt-1">阈值越高连线越少（实时预览，不重排）</div>
      </div>

      <div>
        <div className="text-xs font-medium text-gray-700 mb-2">分类</div>
        <div className="space-y-1">
          {categories.map((c) => (
            <Checkbox
              key={c}
              checked={filters.categories.includes(c)}
              onChange={() => setFilters({ categories: toggleInList(filters.categories, c) })}
              className="!text-xs"
            >
              {c}
            </Checkbox>
          ))}
          {categories.length === 0 && <div className="text-xs text-gray-400">无</div>}
        </div>
      </div>

      {tags.length > 0 && (
        <div>
          <div className="text-xs font-medium text-gray-700 mb-2">标签</div>
          <div className="flex flex-wrap gap-1">
            {tags.map((t) => (
              <Tag
                key={t}
                color={filters.tags.includes(t) ? 'blue' : 'default'}
                className="cursor-pointer !text-xs !mr-0"
                onClick={() => setFilters({ tags: toggleInList(filters.tags, t) })}
              >
                {t}
              </Tag>
            ))}
          </div>
        </div>
      )}

      {graph && graph.entityCount > 0 && (
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium text-gray-700">只看AI实体</span>
          <Switch
            size="small"
            checked={filters.entitiesOnly}
            onChange={(v) => setFilters({ entitiesOnly: v })}
          />
        </div>
      )}
    </div>
  )
}
