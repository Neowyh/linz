import type { ComponentType } from 'react'
import { lazy } from 'react'
import {
  ApartmentOutlined,
  CodeOutlined,
  DeploymentUnitOutlined,
  FolderOpenOutlined,
  GlobalOutlined,
  LineChartOutlined,
  MessageOutlined,
  SearchOutlined
} from '@ant-design/icons'
import { Outlet } from 'react-router-dom'
import type { PanelTypeDef } from './types'
import { PANEL_META, getPanelMeta } from './panelMeta'
import BrowserPanel from '../components/RightPanel/BrowserPanel'
import TerminalPanel from '../components/RightPanel/TerminalPanel'
import FilePanel from '../components/RightPanel/FilePanel'
import KbPanel from '../components/panels/KbPanel'
import type { PanelTypeId } from './types'

/** chat 锚点：渲染当前路由页面（<Outlet/>），由 dock 定位在其锚点窗格内 */
function ChatAnchorContent(): JSX.Element {
  return <Outlet />
}

export interface RegisteredPanel extends PanelTypeDef {}

/**
 * 面板注册表：加载到 dock 里的可组合组件。
 * 目前可用 chat/browser/terminal/files；kb/viewer3d/field/sql 在对应里程碑接入。
 */
export const PANEL_REGISTRY: RegisteredPanel[] = [
  { ...getPanelMeta('chat'), icon: <MessageOutlined />, component: ChatAnchorContent },
  {
    ...getPanelMeta('browser'),
    icon: <GlobalOutlined />,
    component: (() => {
      const C: ComponentType<{ instanceId: string; panelType: PanelTypeId }> = (p) => (
        <BrowserPanel panelType={p.panelType} instanceId={p.instanceId} />
      )
      return C
    })()
  },
  {
    ...getPanelMeta('terminal'),
    icon: <CodeOutlined />,
    component: (() => {
      const C: ComponentType<{ instanceId: string; panelType: PanelTypeId }> = (p) => (
        <TerminalPanel panelType={p.panelType} instanceId={p.instanceId} />
      )
      return C
    })()
  },
  {
    ...getPanelMeta('files'),
    icon: <FolderOpenOutlined />,
    component: (() => {
      const C: ComponentType<{ instanceId: string; panelType: PanelTypeId }> = (p) => (
        <FilePanel panelType={p.panelType} instanceId={p.instanceId} />
      )
      return C
    })()
  },
  {
    ...getPanelMeta('kb'),
    icon: <SearchOutlined />,
    component: (() => {
      const C: ComponentType<{ instanceId: string; panelType: PanelTypeId }> = (p) => (
        <KbPanel panelType={p.panelType} instanceId={p.instanceId} />
      )
      return C
    })()
  },
  {
    ...getPanelMeta('viewer3d'),
    icon: <DeploymentUnitOutlined />,
    component: lazy(() => import('../components/panels/Viewer3DPanel')) as unknown as ComponentType<{
      instanceId: string
      panelType: PanelTypeId
    }>
  },
  {
    ...getPanelMeta('field'),
    icon: <LineChartOutlined />,
    component: lazy(() => import('../components/panels/SolverResultsPanel')) as unknown as ComponentType<{
      instanceId: string
      panelType: PanelTypeId
    }>
  },
  {
    ...getPanelMeta('synapse'),
    icon: <ApartmentOutlined />,
    component: lazy(() => import('../components/panels/SynapsePanel')) as unknown as ComponentType<{
      instanceId: string
      panelType: PanelTypeId
    }>
  }
]

const registryMap = new Map<PanelTypeId, RegisteredPanel>(
  PANEL_REGISTRY.map((p) => [p.id, p])
)

export function getRegisteredPanel(id: PanelTypeId): RegisteredPanel | undefined {
  return registryMap.get(id)
}

/** 图标备忘（供 AddPanelPicker / 页签条使用）；未随组件注册的这里给个兜底 */
export function panelIcon(id: PanelTypeId): JSX.Element {
  switch (id) {
    case 'chat':
      return <MessageOutlined />
    case 'browser':
      return <GlobalOutlined />
    case 'terminal':
      return <CodeOutlined />
    case 'files':
      return <FolderOpenOutlined />
    default:
      return <FolderOpenOutlined />
  }
}

export { PANEL_META }
