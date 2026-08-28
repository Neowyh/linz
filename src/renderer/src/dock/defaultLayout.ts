import { genNodeId } from './types'
import { makeInstance } from './dockStore'
import type {
  DockLayout,
  Pane,
  PanelInstance,
  PanelTypeId,
  SplitNode,
  Tab
} from './types'

function tabFor(panelType: PanelTypeId, title: string, instanceId?: string): Tab {
  return { id: genNodeId('tab'), panelType, title, instanceId }
}

/** 默认首启布局：左边锚点(chat)，右边"工具"窗格(浏览器/终端/文件)，与旧版观感一致 */
export function buildDefaultLayout(): DockLayout {
  const anchorId = genNodeId('pane')
  const toolsId = genNodeId('pane')
  const rootId = genNodeId('split')

  const anchorTab = tabFor('chat', '对话')
  const anchor: Pane = {
    id: anchorId,
    kind: 'pane',
    tabs: [anchorTab],
    activeTabId: anchorTab.id,
    anchor: true
  }

  const instances: Record<string, PanelInstance> = {}
  const browserInst = makeInstance('browser', toolsId)
  const terminalInst = makeInstance('terminal', toolsId)
  const filesInst = makeInstance('files', toolsId)
  instances[browserInst.id] = browserInst
  instances[terminalInst.id] = terminalInst
  instances[filesInst.id] = filesInst

  const browserTab = tabFor('browser', '浏览器 1', browserInst.id)
  const terminalTab = tabFor('terminal', '终端 1', terminalInst.id)
  const filesTab = tabFor('files', '文件', filesInst.id)
  const tools: Pane = {
    id: toolsId,
    kind: 'pane',
    tabs: [browserTab, terminalTab, filesTab],
    activeTabId: browserTab.id
  }

  const root: SplitNode = {
    id: rootId,
    kind: 'split',
    direction: 'row',
    ratio: 0.68,
    children: [anchorId, toolsId]
  }

  return {
    version: 1,
    rootId,
    byId: { [anchorId]: anchor, [toolsId]: tools, [rootId]: root },
    instances
  }
}

/** 首启/hydrate 兜底：保证存在且仅存在一个锚点窗格 */
export function ensureAnchorPane(layout: DockLayout): DockLayout {
  const hasAnchor = Object.values(layout.byId).some(
    (n) => n.kind === 'pane' && (n as Pane).anchor
  )
  if (hasAnchor) return layout
  // 无锚点：临时建一个，挂到根
  const anchorId = genNodeId('pane')
  const anchorTab = tabFor('chat', '对话')
  const anchor: Pane = {
    id: anchorId,
    kind: 'pane',
    tabs: [anchorTab],
    activeTabId: anchorTab.id,
    anchor: true
  }
  layout.byId[anchorId] = anchor
  if (!layout.rootId) {
    layout.rootId = anchorId
  } else {
    const root = layout.byId[layout.rootId]
    if (root && root.kind === 'split') {
      root.children.push(anchorId)
    }
  }
  return layout
}
