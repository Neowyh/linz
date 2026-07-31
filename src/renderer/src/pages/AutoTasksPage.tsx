import { useState, useEffect } from 'react'
import { Button, Modal, Form, Input, Select, Switch, Tag, Empty, message, notification } from 'antd'
import { PlusOutlined, DeleteOutlined, PlayCircleOutlined } from '@ant-design/icons'

interface AutoTaskData {
  id: string
  name: string
  description: string | null
  cron_expression: string
  agents: string
  is_active: number
  last_run: string | null
  next_run: string | null
  run_count: number
  result_action: string
  created_at: string
}

const FREQUENCY_OPTIONS = [
  { label: '每小时', value: '0 * * * *' },
  { label: '每6小时', value: '0 */6 * * *' },
  { label: '每天 08:00', value: '0 8 * * *' },
  { label: '每天 17:30', value: '30 17 * * *' },
  { label: '每周一 09:00', value: '0 9 * * 1' },
  { label: '自定义', value: 'custom' }
]

const AGENT_OPTIONS = [
  { label: '协调 Agent', value: 'orchestrator' },
  { label: '气动 Agent', value: 'aero' },
  { label: '结构 Agent', value: 'structural' },
  { label: '推进 Agent', value: 'propulsion' },
  { label: '航电 Agent', value: 'avionics' },
  { label: '文档 Agent', value: 'documentation' }
]

const TASK_TEMPLATES = [
  { name: '每日设计进度报告', description: '收集所有Agent昨日完成的分析结果，生成进度摘要', cron: '0 8 * * *', agents: ['orchestrator', 'documentation'] },
  { name: '气动参数变化监控', description: '检测关键气动参数是否发生超预期偏差', cron: '0 */6 * * *', agents: ['orchestrator', 'aero'] },
  { name: '航空文献更新追踪', description: '追踪指定关键词的最新arxiv/AIAA论文', cron: '0 9 * * 1', agents: ['retriever'] },
  { name: '每日设计日志', description: '汇总当日所有设计讨论要点', cron: '30 17 * * *', agents: ['orchestrator', 'documentation'] }
]

export default function AutoTasksPage(): JSX.Element {
  const [tasks, setTasks] = useState<AutoTaskData[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [testingIds, setTestingIds] = useState<Set<string>>(new Set())
  const [form] = Form.useForm()

  const fetchTasks = async (): Promise<void> => {
    setLoading(true)
    try {
      const list = await window.aeromind.autoTask.list()
      setTasks(list)
    } catch {
      message.error('加载任务列表失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchTasks() }, [])

  // 任务执行完成（含测试运行）时页面内弹出结果摘要，并刷新运行次数
  useEffect(() => {
    const unsubscribe = window.aeromind.autoTask.onNotification((data: { title?: string; body?: string }) => {
      notification.info({
        message: `自动任务完成：${data.title || ''}`,
        description: data.body || '',
        placement: 'bottomRight',
        duration: 8
      })
      setTestingIds(new Set())
      fetchTasks()
    })
    return unsubscribe
  }, [])

  const handleTest = async (task: AutoTaskData): Promise<void> => {
    setTestingIds((prev) => new Set(prev).add(task.id))
    try {
      const result = await window.aeromind.autoTask.test(task.id)
      if (result?.success) {
        message.success(`已开始测试运行「${task.name}」，完成后将弹出结果摘要`)
      } else {
        message.warning(result?.message || '测试运行失败')
        setTestingIds((prev) => {
          const next = new Set(prev)
          next.delete(task.id)
          return next
        })
      }
    } catch {
      message.error('测试运行失败')
      setTestingIds((prev) => {
        const next = new Set(prev)
        next.delete(task.id)
        return next
      })
    }
  }

  const handleCreate = async (values: any): Promise<void> => {
    try {
      await window.aeromind.autoTask.create({
        name: values.name,
        description: values.description,
        cron_expression: values.cron_expression === 'custom' ? values.custom_cron : values.cron_expression,
        agents: JSON.stringify(values.agents || ['orchestrator']),
        result_action: values.result_action || 'notify'
      })
      message.success('任务已创建')
      setShowCreate(false)
      form.resetFields()
      fetchTasks()
    } catch {
      message.error('创建任务失败')
    }
  }

  const handleToggle = async (id: string): Promise<void> => {
    await window.aeromind.autoTask.toggle(id)
    fetchTasks()
  }

  const handleDelete = async (id: string): Promise<void> => {
    Modal.confirm({
      title: '确认删除',
      content: '确定要删除这个自动任务吗？',
      onOk: async () => {
        await window.aeromind.autoTask.delete(id)
        message.success('已删除')
        fetchTasks()
      }
    })
  }

  const handleAddTemplate = async (tpl: typeof TASK_TEMPLATES[0]): Promise<void> => {
    try {
      await window.aeromind.autoTask.create({
        name: tpl.name,
        description: tpl.description,
        cron_expression: tpl.cron,
        agents: JSON.stringify(tpl.agents)
      })
      message.success('任务已添加')
      fetchTasks()
    } catch {
      message.error('添加任务失败')
    }
  }

  const getCronLabel = (cron: string): string => {
    const opt = FREQUENCY_OPTIONS.find((o) => o.value === cron)
    return opt ? opt.label : cron
  }

  return (
    <div className="h-full overflow-y-auto p-6">
      <div className="max-w-4xl mx-auto">
        {/* 标题栏 */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">自动任务</h2>
            <p className="text-xs text-gray-600 mt-1">请保持软件运行；任务执行结果将通过系统通知推送</p>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setShowCreate(true)}>
            新建自动任务
          </Button>
        </div>

        {/* 我的任务列表 */}
        <div className="space-y-3 mb-8">
          {loading ? (
            <div className="text-center py-8 text-gray-600">加载中...</div>
          ) : tasks.length === 0 ? (
            <Empty description="暂无自动任务" />
          ) : (
            tasks.map((task) => (
              <div key={task.id} className="bg-white rounded-card border border-line-light p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Switch
                      size="small"
                      checked={task.is_active === 1}
                      onChange={() => handleToggle(task.id)}
                    />
                    <div>
                      <h4 className="text-sm font-medium text-gray-900">{task.name}</h4>
                      <p className="text-xs text-gray-600 mt-0.5">{task.description}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <Tag color="blue">{getCronLabel(task.cron_expression)}</Tag>
                    <span className="text-xs text-gray-300">已运行{task.run_count}次</span>
                    <Button
                      type="text"
                      size="small"
                      icon={<PlayCircleOutlined />}
                      loading={testingIds.has(task.id)}
                      onClick={() => handleTest(task)}
                      title="立即测试运行一次，无需等到计划时间"
                    >
                      测试
                    </Button>
                    <Button type="text" size="small" icon={<DeleteOutlined />} onClick={() => handleDelete(task.id)} danger />
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {/* 推荐模板 */}
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">推荐模板</h3>
          <div className="grid grid-cols-2 gap-3">
            {TASK_TEMPLATES.map((tpl, idx) => (
              <div key={idx} className="bg-white rounded-card border border-line-light p-4 shadow-card">
                <h4 className="text-sm font-medium text-gray-900">{tpl.name}</h4>
                <p className="text-xs text-gray-600 mt-1">{tpl.description}</p>
                <div className="flex items-center justify-between mt-3">
                  <Tag color="blue">{getCronLabel(tpl.cron)}</Tag>
                  <Button size="small" onClick={() => handleAddTemplate(tpl)}>添加</Button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 创建任务弹窗 */}
      <Modal
        title="新建自动任务"
        open={showCreate}
        onCancel={() => { setShowCreate(false); form.resetFields() }}
        onOk={() => form.submit()}
        okText="创建任务"
        width={520}
      >
        <Form form={form} layout="vertical" onFinish={handleCreate}>
          <Form.Item name="name" label="任务名称" rules={[{ required: true, message: '请输入任务名称' }]}>
            <Input placeholder="如：每日设计进度报告" />
          </Form.Item>
          <Form.Item name="description" label="任务描述">
            <Input.TextArea rows={2} placeholder="描述这个任务需要 Agent 做什么…" />
          </Form.Item>
          <Form.Item name="cron_expression" label="执行频率" rules={[{ required: true }]} initialValue="0 8 * * *">
            <Select options={FREQUENCY_OPTIONS} />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(prev, cur) => prev.cron_expression !== cur.cron_expression}>
            {({ getFieldValue }) => getFieldValue('cron_expression') === 'custom' ? (
              <Form.Item name="custom_cron" label="Cron 表达式" rules={[{ required: true }]}>
                <Input placeholder="0 8 * * 1-5" />
              </Form.Item>
            ) : null}
          </Form.Item>
          <Form.Item name="agents" label="调用 Agent" initialValue={['orchestrator']}>
            <Select mode="multiple" options={AGENT_OPTIONS} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
