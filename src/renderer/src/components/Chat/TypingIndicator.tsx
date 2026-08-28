import { useEffect, useState } from 'react'

// 动态等待文字轮播：即使流的首个 chunk 还没到达，也让用户直观看到"模型正在工作"
const WAITING_TEXTS = ['正在思考…', '正在分析问题…', '正在组织回答…']

interface TypingIndicatorProps {
  /** standalone=true：对话底部的独立等待气泡（模型首个 Agent 气泡未出现前）；false：Agent 气泡内联 */
  standalone?: boolean
}

/**
 * 动态等待标志：三点跳动动画 + 轮播状态文案。
 * 在模型回答前的窗口期提示用户仍在工作，避免误以为模型卡死。
 */
export default function TypingIndicator({ standalone = false }: TypingIndicatorProps): JSX.Element {
  const [textIdx, setTextIdx] = useState(0)

  useEffect(() => {
    const timer = setInterval(() => setTextIdx((i) => (i + 1) % WAITING_TEXTS.length), 2000)
    return () => clearInterval(timer)
  }, [])

  const dots = (
    <span className="flex items-center gap-1" aria-label="正在思考">
      <span className="typing-dot" />
      <span className="typing-dot" style={{ animationDelay: '0.15s' }} />
      <span className="typing-dot" style={{ animationDelay: '0.3s' }} />
    </span>
  )

  const text = <span className="text-xs text-gray-400 select-none">{WAITING_TEXTS[textIdx]}</span>

  if (!standalone) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        {dots}
        {text}
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 w-fit rounded-2xl rounded-bl-sm bg-white border border-line-light shadow-card px-4 py-3 mb-4">
      {dots}
      {text}
    </div>
  )
}