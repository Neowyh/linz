import React from 'react'

/**
 * 统一图标渲染组件。
 * - 如果 icon 是 URL（以 assets/ 开头，或以 .svg/.png/.jpg/.jpeg 结尾），按图片渲染。
 * - 否则按 emoji / 文本回显。
 * 这样历史数据里用户自定义的 emoji 仍能显示，内置 Agent 的 SVG 图标在 Win7 上也能正常加载。
 */
export interface AgentIconProps {
  icon?: string | React.ReactNode
  className?: string
  style?: React.CSSProperties
  alt?: string
}

function isIconUrl(value: string): boolean {
  return (
    value.startsWith('assets/') ||
    value.startsWith('http://') ||
    value.startsWith('https://') ||
    value.startsWith('/') ||
    /\.(svg|png|jpg|jpeg|webp|gif)$/i.test(value)
  )
}

export const AgentIcon: React.FC<AgentIconProps> = ({ icon, className, style, alt }) => {
  if (!icon) return null

  if (typeof icon !== 'string') {
    return <span className={className} style={style}>{icon}</span>
  }

  if (isIconUrl(icon)) {
    return (
      <img
        src={icon}
        alt={alt || 'icon'}
        className={className}
        style={{ display: 'inline-block', verticalAlign: 'middle', ...style }}
      />
    )
  }

  return <span className={className} style={style}>{icon}</span>
}

export default AgentIcon
