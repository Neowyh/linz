import React from 'react'
import AgentIcon from './AgentIcon'

export interface AgentIconOption {
  value: string
  label: string
}

interface AgentIconPickerProps {
  value: string
  onChange: (value: string) => void
  options: AgentIconOption[]
}

export const AGENT_ICON_OPTIONS: AgentIconOption[] = [
  { value: 'assets/icons/orchestrator.svg', label: '协调' },
  { value: 'assets/icons/general.svg', label: '通用' },
  { value: 'assets/icons/aero.svg', label: '气动' },
  { value: 'assets/icons/structural.svg', label: '结构' },
  { value: 'assets/icons/propulsion.svg', label: '推进' },
  { value: 'assets/icons/avionics.svg', label: '航电' },
  { value: 'assets/icons/simulation.svg', label: '仿真' },
  { value: 'assets/icons/documentation.svg', label: '文档' },
  { value: 'assets/icons/retriever.svg', label: '检索' },
  { value: 'assets/icons/asset/Asset-retrieval.svg', label: '资产检索' },
  { value: 'assets/icons/asset/asset-Management.svg', label: '资产管理' },
  { value: 'assets/icons/asset/autonomous-control.svg', label: '自主控制' },
  { value: 'assets/icons/asset/Autonomous-operation-management.svg', label: '自主运行管理' },
  { value: 'assets/icons/asset/Check-and-correct-plan.svg', label: '检查纠正计划' },
  { value: 'assets/icons/asset/Comprehensive-strategic-management.svg', label: '综合战略管理' },
  { value: 'assets/icons/asset/Consumables-management.svg', label: '耗材管理' },
  { value: 'assets/icons/asset/Data-collection-and-translation.svg', label: '数据采集转换' },
  { value: 'assets/icons/asset/Energy-and-Carbon-Management.svg', label: '能源碳管理' },
  { value: 'assets/icons/asset/Engineering-Affairs-Management.svg', label: '工程事务管理' },
  { value: 'assets/icons/asset/Equipment-and-facility-operation-and-maintenance.svg', label: '设备设施运维' },
  { value: 'assets/icons/asset/Exception-event-management.svg', label: '异常事件管理' },
  { value: 'assets/icons/asset/Experience-service-tools.svg', label: '体验服务工具' },
  { value: 'assets/icons/asset/Integrated-information-management.svg', label: '综合信息管理' },
  { value: 'assets/icons/asset/Intelligent-unattended.svg', label: '智能无人值守' },
  { value: 'assets/icons/asset/IoT-solution-configuration.svg', label: '物联网方案配置' },
  { value: 'assets/icons/asset/meter-reading.svg', label: '抄表' },
  { value: 'assets/icons/asset/metric-board.svg', label: '指标看板' },
  { value: 'assets/icons/asset/On-site-research.svg', label: '现场调研' },
  { value: 'assets/icons/asset/On-site-survey-management.svg', label: '现场勘查管理' },
  { value: 'assets/icons/asset/placeholder-icon.svg', label: '占位图标' },
  { value: 'assets/icons/asset/Property-execution-management.svg', label: '资产执行管理' },
  { value: 'assets/icons/asset/Report-generation-management.svg', label: '报告生成管理' },
  { value: 'assets/icons/asset/Report-record.svg', label: '报告记录' },
  { value: 'assets/icons/asset/Risk-and-Hazard-Management.svg', label: '风险隐患管理' },
  { value: 'assets/icons/asset/System-global-configuration.svg', label: '系统全局配置' },
  { value: 'assets/icons/asset/Tool-management.svg', label: '工具管理' },
  { value: 'assets/icons/asset/Work-order-management.svg', label: '工单管理' }
]

export const AgentIconPicker: React.FC<AgentIconPickerProps> = ({ value, onChange, options }) => (
  <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-2">
    {options.map((option) => {
      const selected = value === option.value
      return (
        <button
          key={option.value}
          type="button"
          title={option.label}
          aria-label={`选择${option.label}图标`}
          aria-pressed={selected}
          onClick={() => onChange(option.value)}
          className={`h-14 rounded-lg border flex flex-col items-center justify-center gap-1 transition-colors ${
            selected
              ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200'
              : 'border-gray-200 bg-white hover:border-blue-300 hover:bg-blue-50/50'
          }`}
        >
          <AgentIcon icon={option.value} className="w-7 h-7 object-contain" alt={option.label} />
          <span className="text-[10px] text-gray-500 truncate max-w-full px-1">{option.label}</span>
        </button>
      )
    })}
  </div>
)

export default AgentIconPicker
