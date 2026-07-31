import type { TaskTemplate as TaskTemplateType } from '../../types/chat'
import AgentIcon from '../AgentIcon'

interface TaskTemplateProps {
  template: TaskTemplateType
  onClick: (prompt: string) => void
}

export default function TaskTemplate({ template, onClick }: TaskTemplateProps): JSX.Element {
  return (
    <button
      onClick={() => onClick(template.prompt)}
      className="text-left p-4 rounded-card border border-line-light bg-white shadow-card hover:border-primary/40 hover:shadow-card-hover hover:-translate-y-0.5 transition-all group"
    >
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg bg-primary-light flex items-center justify-center flex-shrink-0 group-hover:scale-105 transition-transform">
          <AgentIcon icon={template.icon} className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-gray-900 group-hover:text-primary transition-colors">
            {template.title}
          </h4>
          <p className="text-xs text-gray-500 mt-1 line-clamp-2 leading-relaxed">{template.description}</p>
        </div>
      </div>
    </button>
  )
}

// 预置的推荐任务模板
export const DEFAULT_TASK_TEMPLATES: TaskTemplateType[] = [
  {
    id: 'aero-airfoil',
    icon: 'assets/icons/aero.svg',
    title: '翼型优化分析',
    description: '输入展弦比、马赫数等参数，分析翼型的升阻特性',
    category: '气动设计',
    prompt: '请分析NACA 2412翼型在巡航马赫数0.3下的升阻比特性，包括不同迎角下的升力系数和阻力系数变化趋势'
  },
  {
    id: 'overall-params',
    icon: 'assets/icons/propulsion.svg',
    title: '总体参数估算',
    description: '给定载重和航程，估算起飞重量等总体参数',
    category: '总体设计',
    prompt: '设计一款航程500km、载重50kg的固定翼无人机，请进行总体参数快速估算，包括起飞重量、翼面积、展弦比等关键参数'
  },
  {
    id: 'cfd-prep',
    icon: 'assets/icons/simulation.svg',
    title: 'CFD前处理建议',
    description: '帮我准备RANS仿真的边界条件设置',
    category: '气动设计',
    prompt: '请为一架巡航速度200km/h的小型无人机机翼提供RANS CFD仿真的边界条件设置建议，包括来流条件、湍流模型选择和网格要求'
  },
  {
    id: 'report-gen',
    icon: 'assets/icons/documentation.svg',
    title: '设计报告生成',
    description: '根据当前设计状态，自动生成技术报告',
    category: '文档输出',
    prompt: '请根据我们的设计讨论，生成一份飞行器气动设计技术报告的框架，包括设计要求、分析方法、结果汇总和结论建议等章节'
  }
]
