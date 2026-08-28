import { useState, useEffect } from 'react'
import { Modal, Input, Button, message, Select, Space, Switch, Progress, InputNumber, Radio, Tag } from 'antd'
import { KeyOutlined, CheckCircleOutlined, BulbOutlined, ApiOutlined, LoadingOutlined } from '@ant-design/icons'
import { useSettingsStore } from '../../stores/settingsStore'
import SecuritySettingsPanel from './SecuritySettingsPanel'

const PROVIDER_PRESETS: Record<string, { label: string; baseURL: string; modelName: string }> = {
  deepseek: { label: 'DeepSeek', baseURL: 'https://api.deepseek.com', modelName: 'deepseek-chat' },
  openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', modelName: 'gpt-4o-mini' },
  qwen: { label: '阿里云通义', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', modelName: 'qwen-max' }
}

export default function SettingsModal(): JSX.Element {
  const showSettings = useSettingsStore((s) => s.showSettings)
  const setShowSettings = useSettingsStore((s) => s.setShowSettings)
  const apiKey = useSettingsStore((s) => s.apiKey)
  const modelProvider = useSettingsStore((s) => s.modelProvider)
  const themeSetting = useSettingsStore((s) => s.theme)
  const setApiKey = useSettingsStore((s) => s.setApiKey)
  const setTheme = useSettingsStore((s) => s.setTheme)

  const [keyInput, setKeyInput] = useState('')
  const [provider, setProvider] = useState(modelProvider)
  const [baseURL, setBaseURL] = useState('')
  const [modelName, setModelName] = useState('')
  const [testing, setTesting] = useState(false)
  const [localTheme, setLocalTheme] = useState<'light' | 'dark' | 'system'>(themeSetting)

  // Token budget state
  const [budgetEnabled, setBudgetEnabled] = useState(true)
  const [monthlyLimit, setMonthlyLimit] = useState(1000000)
  const [warningThreshold, setWarningThreshold] = useState(0.8)
  const [currentUsage, setCurrentUsage] = useState({ inputTokens: 0, outputTokens: 0 })
  const [budgetPercentage, setBudgetPercentage] = useState(0)

  // Ollama state
  const ollama = useSettingsStore((s) => s.ollama)
  const setOllama = useSettingsStore((s) => s.setOllama)
  const [ollamaEnabled, setOllamaEnabled] = useState(false)
  const [ollamaBaseURL, setOllamaBaseURL] = useState('http://localhost:11434')
  const [ollamaModelName, setOllamaModelName] = useState('qwen2.5:7b')
  const [ollamaChecking, setOllamaChecking] = useState(false)
  const [ollamaAvailable, setOllamaAvailable] = useState<boolean | null>(null)

  // 技能脚本执行开关（立即生效，不随"保存"按钮）
  const [skillScriptEnabled, setSkillScriptEnabled] = useState(false)

  // 关闭行为开关：生产模式下关闭窗口时退出进程（立即生效，不随"保存"按钮）
  const [quitOnClose, setQuitOnClose] = useState(true)

  const handleQuitOnCloseToggle = async (enabled: boolean): Promise<void> => {
    setQuitOnClose(enabled)
    await window.aeromind.settings.set('quitOnClose', enabled)
    message.success(enabled ? '已开启：点击关闭按钮将直接退出程序' : '已关闭：点击关闭按钮将最小化到系统托盘')
  }

  const handleSkillScriptToggle = async (enabled: boolean): Promise<void> => {
    setSkillScriptEnabled(enabled)
    await window.aeromind.settings.set('skillScriptEnabled', enabled)
    if (enabled) {
      message.success('已允许执行技能脚本；每个技能首次执行时会弹窗请求确认')
    } else {
      message.info('已禁止执行技能脚本')
    }
  }

  // 同步 store 状态到本地
  useEffect(() => {
    const loadValues = async (): Promise<void> => {
      const [savedBaseURL, savedModel, savedFallback, budgetData, savedSkillScript, savedQuitOnClose] = await Promise.all([
        window.aeromind.settings.get('baseURL'),
        window.aeromind.settings.get('modelName'),
        window.aeromind.settings.get('fallbackModel'),
        window.aeromind.token.getBudget(),
        window.aeromind.settings.get('skillScriptEnabled'),
        window.aeromind.settings.get('quitOnClose')
      ])
      setBaseURL(savedBaseURL || PROVIDER_PRESETS[provider]?.baseURL || '')
      setModelName(savedModel || PROVIDER_PRESETS[provider]?.modelName || '')
      setSkillScriptEnabled(Boolean(savedSkillScript))
      setQuitOnClose(savedQuitOnClose === undefined ? true : Boolean(savedQuitOnClose))
      if (budgetData) {
        setBudgetEnabled(budgetData.enabled)
        setMonthlyLimit(budgetData.monthlyLimit)
        setWarningThreshold(budgetData.warningThreshold)
        setCurrentUsage(budgetData.currentUsage)
        setBudgetPercentage(budgetData.percentage)
      }
    }
    if (showSettings) {
      setKeyInput(apiKey)
      setLocalTheme(themeSetting)
      setOllamaEnabled(ollama.enabled)
      setOllamaBaseURL(ollama.baseURL)
      setOllamaModelName(ollama.modelName)
      setOllamaAvailable(null)
      loadValues()
    }
  }, [showSettings, apiKey, provider, themeSetting, ollama])

  const handleProviderChange = (value: string): Promise<void> => {
    setProvider(value)
    const preset = PROVIDER_PRESETS[value]
    if (preset) {
      setBaseURL(preset.baseURL)
      setModelName(preset.modelName)
    }
    return Promise.resolve()
  }

  const handleSave = async (): Promise<void> => {
    if (keyInput.trim()) {
      await setApiKey(keyInput.trim())
    }
    await window.aeromind.settings.set('modelProvider', provider)
    await window.aeromind.settings.set('baseURL', baseURL)
    await window.aeromind.settings.set('modelName', modelName)
    await window.aeromind.settings.set('tokenBudget', {
      monthlyLimit,
      warningThreshold,
      enabled: budgetEnabled
    })
    await setTheme(localTheme)
    await setOllama({
      enabled: ollamaEnabled,
      baseURL: ollamaBaseURL,
      modelName: ollamaModelName
    })
    message.success('设置已保存')
    setShowSettings(false)
  }

  const handleTest = async (): Promise<void> => {
    if (!keyInput.trim()) {
      message.warning('请先输入 API Key')
      return
    }
    setTesting(true)
    try {
      // 保存配置后验证
      await setApiKey(keyInput.trim())
      await window.aeromind.settings.set('baseURL', baseURL)
      await window.aeromind.settings.set('modelName', modelName)
      message.success('API Key 配置成功')
    } catch {
      message.error('配置失败，请检查 API Key')
    } finally {
      setTesting(false)
    }
  }

  return (
    <Modal
      title="设置"
      open={showSettings}
      onCancel={() => setShowSettings(false)}
      footer={null}
      width={520}
    >
      <div className="py-4 space-y-6">
        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">API 配置</h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">模型供应商</label>
              <Select
                value={provider}
                onChange={handleProviderChange}
                className="w-full"
                options={Object.entries(PROVIDER_PRESETS).map(([key, val]) => ({
                  label: val.label,
                  value: key
                }))}
              />
            </div>

            <div>
              <label className="text-xs text-gray-600 mb-1 block">API Key</label>
              <Input.Password
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="sk-..."
                prefix={<KeyOutlined />}
              />
            </div>

            <div>
              <label className="text-xs text-gray-600 mb-1 block">Base URL</label>
              <Input
                value={baseURL}
                onChange={(e) => setBaseURL(e.target.value)}
                placeholder="https://api.deepseek.com"
              />
            </div>

            <div>
              <label className="text-xs text-gray-600 mb-1 block">模型名称</label>
              <Input
                value={modelName}
                onChange={(e) => setModelName(e.target.value)}
                placeholder="deepseek-chat"
              />
            </div>

            <Space>
              <Button
                icon={<CheckCircleOutlined />}
                onClick={handleTest}
                loading={testing}
                size="small"
              >
                验证
              </Button>
            </Space>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
            <BulbOutlined />
            外观设置
          </h3>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-gray-600 mb-1 block">主题模式</label>
              <Radio.Group
                value={localTheme}
                onChange={(e) => setLocalTheme(e.target.value)}
                optionType="button"
                buttonStyle="solid"
              >
                <Radio.Button value="light">亮色</Radio.Button>
                <Radio.Button value="dark">深色</Radio.Button>
                <Radio.Button value="system">跟随系统</Radio.Button>
              </Radio.Group>
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3 flex items-center gap-2">
            <ApiOutlined />
            本地模型 (Ollama)
          </h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-600">启用 Ollama 本地模型</label>
              <Switch
                checked={ollamaEnabled}
                onChange={setOllamaEnabled}
                size="small"
              />
            </div>

            {ollamaEnabled && (
              <>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">Ollama 服务地址</label>
                  <Input
                    value={ollamaBaseURL}
                    onChange={(e) => setOllamaBaseURL(e.target.value)}
                    placeholder="http://localhost:11434"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600 mb-1 block">模型名称</label>
                  <Input
                    value={ollamaModelName}
                    onChange={(e) => setOllamaModelName(e.target.value)}
                    placeholder="qwen2.5:7b"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <Button
                    size="small"
                    onClick={async () => {
                      setOllamaChecking(true)
                      try {
                        // Save URL first so check uses the new value
                        await setOllama({ baseURL: ollamaBaseURL })
                        const available = await window.aeromind.ollama.check()
                        setOllamaAvailable(available)
                        if (available) {
                          message.success('Ollama 服务连接成功')
                        } else {
                          message.warning('无法连接 Ollama 服务，请确认已安装并启动')
                        }
                      } catch {
                        setOllamaAvailable(false)
                        message.error('连接检测失败')
                      } finally {
                        setOllamaChecking(false)
                      }
                    }}
                    icon={ollamaChecking ? <LoadingOutlined /> : undefined}
                    disabled={ollamaChecking}
                  >
                    检测连接
                  </Button>
                  {ollamaAvailable !== null && (
                    <Tag color={ollamaAvailable ? 'success' : 'error'}>
                      {ollamaAvailable ? '已连接' : '未连接'}
                    </Tag>
                  )}
                </div>

                <div className="text-xs text-gray-600 p-2 bg-gray-50 rounded">
                  启用后，当云端模型不可用时将自动切换到本地 Ollama 模型。需先安装 Ollama 并下载对应模型。
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">Token 预算</h3>
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs text-gray-600">启用预算控制</label>
              <Switch
                checked={budgetEnabled}
                onChange={setBudgetEnabled}
                size="small"
              />
            </div>

            {budgetEnabled && (
              <>
                <div>
                  <label className="text-xs text-gray-600 mb-1 block">月度预算（tokens）</label>
                  <InputNumber
                    value={monthlyLimit}
                    onChange={(v) => setMonthlyLimit(v || 1000000)}
                    min={10000}
                    step={100000}
                    className="w-full"
                    formatter={(value) => `${value}`.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}
                    parser={(value) => Number(value?.replace(/,/g, '') || 1000000)}
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600 mb-1 block">警告阈值（%）</label>
                  <InputNumber
                    value={Math.round(warningThreshold * 100)}
                    onChange={(v) => setWarningThreshold((v || 80) / 100)}
                    min={50}
                    max={100}
                    step={5}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="text-xs text-gray-600 mb-1 block">本月使用量</label>
                  <div className="flex items-center gap-3">
                    <Progress
                      percent={Math.round(budgetPercentage * 100)}
                      size="small"
                      status={budgetPercentage >= warningThreshold ? 'exception' : 'normal'}
                      className="flex-1"
                    />
                    <span className="text-xs text-gray-600 whitespace-nowrap">
                      {(currentUsage.inputTokens + currentUsage.outputTokens).toLocaleString()} / {monthlyLimit.toLocaleString()}
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">关闭行为</h3>
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <label className="text-xs text-gray-600">关闭窗口时退出程序</label>
              <p className="text-[11px] text-gray-400 mt-0.5">
                开启后点击窗口关闭按钮将直接退出进程；关闭后最小化到系统托盘常驻。
              </p>
            </div>
            <Switch
              checked={quitOnClose}
              onChange={handleQuitOnCloseToggle}
              size="small"
            />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">高级</h3>
          <div className="flex items-center justify-between">
            <div className="pr-4">
              <label className="text-xs text-gray-600">允许执行技能脚本</label>
              <p className="text-[11px] text-gray-400 mt-0.5">
                开启后 Agent 可执行导入技能包中 scripts/ 目录的脚本（.py/.js/.bat 等）。执行前会弹出聊天内安全确认卡，可"允许一次 / 始终允许 / 拒绝"。
              </p>
            </div>
            <Switch
              checked={skillScriptEnabled}
              onChange={handleSkillScriptToggle}
              size="small"
            />
          </div>
        </div>

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">🔒 安全与权限</h3>
          <SecuritySettingsPanel />
        </div>

        <div className="flex justify-end pt-2 border-t border-gray-200">
          <Button onClick={() => setShowSettings(false)} className="mr-2">取消</Button>
          <Button type="primary" onClick={handleSave}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
