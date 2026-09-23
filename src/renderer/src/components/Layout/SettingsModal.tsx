import { useState, useEffect } from 'react'
import { Modal, Input, Button, message, Select, Space, Switch, Radio, Tag, Slider, InputNumber } from 'antd'
import { KeyOutlined, CheckCircleOutlined, BulbOutlined, ApiOutlined, LoadingOutlined, PictureOutlined, DeleteOutlined } from '@ant-design/icons'
import { useSettingsStore, type BackgroundFit } from '../../stores/settingsStore'
import SecuritySettingsPanel from './SecuritySettingsPanel'
import UpdateSettingsPanel from './UpdateSettingsPanel'

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
  // 自定义背景
  const backgroundDataUrl = useSettingsStore((s) => s.backgroundDataUrl)
  const backgroundFileName = useSettingsStore((s) => s.backgroundFileName)
  const backgroundFit = useSettingsStore((s) => s.backgroundFit)
  const backgroundOpacity = useSettingsStore((s) => s.backgroundOpacity)
  const pickBackground = useSettingsStore((s) => s.pickBackground)
  const clearBackground = useSettingsStore((s) => s.clearBackground)
  const setBackgroundFit = useSettingsStore((s) => s.setBackgroundFit)
  const setBackgroundOpacity = useSettingsStore((s) => s.setBackgroundOpacity)
  const updateSettings = useSettingsStore((s) => s.updateSettings)

  const [keyInput, setKeyInput] = useState('')
  const [provider, setProvider] = useState(modelProvider)
  const [baseURL, setBaseURL] = useState('')
  const [modelName, setModelName] = useState('')
  const [testing, setTesting] = useState(false)
  const [localTheme, setLocalTheme] = useState<'light' | 'dark' | 'system'>(themeSetting)

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
  const [maxToolRounds, setMaxToolRounds] = useState(100)

  // 自定义背景图：选择图片时的 loading 态
  const [pickingBg, setPickingBg] = useState(false)

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

  // 自定义背景：即时生效（与开关类设置一致，不走底部"保存"按钮）
  const handlePickBackground = async (): Promise<void> => {
    setPickingBg(true)
    try {
      const result = await pickBackground()
      if (result.ok) {
        message.success('背景图片已更新')
      } else if (result.error && result.error !== '未选择图片') {
        message.error(result.error)
      }
      // 未选择图片（用户取消）时静默处理
    } finally {
      setPickingBg(false)
    }
  }

  const handleClearBackground = async (): Promise<void> => {
    await clearBackground()
    message.success('已恢复默认背景')
  }

  const handleFitChange = (value: string): void => {
    void setBackgroundFit(value as BackgroundFit)
  }

  // 拖拽时仅更新内存态做即时预览，松手后再落盘
  const handleOpacityChange = (v: number | [number, number]): void => {
    updateSettings({ backgroundOpacity: (v as number) / 100 })
  }

  const handleOpacityComplete = (v: number | [number, number]): void => {
    void setBackgroundOpacity((v as number) / 100)
  }

  // 同步 store 状态到本地
  useEffect(() => {
    const loadValues = async (): Promise<void> => {
      const [savedBaseURL, savedModel, savedFallback, savedSkillScript, savedQuitOnClose, savedMaxToolRounds] = await Promise.all([
        window.aeromind.settings.get('baseURL'),
        window.aeromind.settings.get('modelName'),
        window.aeromind.settings.get('fallbackModel'),
        window.aeromind.settings.get('skillScriptEnabled'),
        window.aeromind.settings.get('quitOnClose'),
        window.aeromind.settings.get('maxToolRounds')
      ])
      setBaseURL(savedBaseURL || PROVIDER_PRESETS[provider]?.baseURL || '')
      setModelName(savedModel || PROVIDER_PRESETS[provider]?.modelName || '')
      setSkillScriptEnabled(Boolean(savedSkillScript))
      setQuitOnClose(savedQuitOnClose === undefined ? true : Boolean(savedQuitOnClose))
      setMaxToolRounds(typeof savedMaxToolRounds === 'number' && savedMaxToolRounds > 0 ? savedMaxToolRounds : 100)
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
    await window.aeromind.settings.set('maxToolRounds', maxToolRounds)
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

            <div>
              <label className="text-xs text-gray-600 mb-1 block">工具调用最大轮数</label>
              <InputNumber
                value={maxToolRounds}
                min={1}
                max={1000}
                onChange={(v) => setMaxToolRounds(typeof v === 'number' ? v : 100)}
                className="w-full"
              />
              <p className="text-[11px] text-gray-400 mt-1">单次对话中工具连续调用的轮数上限，防止死循环。默认 100。</p>
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

            <div>
              <label className="text-xs text-gray-600 mb-1 block">自定义背景</label>
              <div className="flex items-center gap-3">
                {backgroundDataUrl ? (
                  <div className="w-16 h-16 rounded-lg border border-gray-200 overflow-hidden flex-shrink-0 bg-gray-100">
                    <img src={backgroundDataUrl} alt="背景预览" className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="w-16 h-16 rounded-lg border border-dashed border-gray-300 flex items-center justify-center flex-shrink-0 text-gray-300">
                    <PictureOutlined style={{ fontSize: 20 }} />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <Space>
                    <Button
                      size="small"
                      icon={<PictureOutlined />}
                      onClick={handlePickBackground}
                      loading={pickingBg}
                    >
                      选择图片
                    </Button>
                    {backgroundDataUrl && (
                      <Button
                        size="small"
                        icon={<DeleteOutlined />}
                        onClick={handleClearBackground}
                        danger
                      >
                        清除
                      </Button>
                    )}
                  </Space>
                  {backgroundFileName && (
                    <p className="text-[11px] text-gray-400 mt-1 truncate">{backgroundFileName}</p>
                  )}
                </div>
              </div>

              {backgroundDataUrl && (
                <div className="space-y-2 mt-3">
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">填充模式</label>
                    <Select
                      size="small"
                      value={backgroundFit}
                      onChange={handleFitChange}
                      className="w-full"
                      options={[
                        { label: '填充（覆盖全屏）', value: 'cover' },
                        { label: '适配（完整显示）', value: 'contain' },
                        { label: '居中（原尺寸）', value: 'center' },
                        { label: '平铺（重复排列）', value: 'repeat' }
                      ]}
                    />
                  </div>
                  <div>
                    <label className="text-xs text-gray-600 mb-1 block">
                      内容透明度 {Math.round(backgroundOpacity * 100)}%
                    </label>
                    <Slider
                      min={0}
                      max={100}
                      value={Math.round(backgroundOpacity * 100)}
                      onChange={handleOpacityChange}
                      onChangeComplete={handleOpacityComplete}
                      className="mt-1"
                    />
                  </div>
                </div>
              )}
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

        <div>
          <h3 className="text-sm font-medium text-gray-900 mb-3">更新</h3>
          <UpdateSettingsPanel />
        </div>

        <div className="flex justify-end pt-2 border-t border-gray-200">
          <Button onClick={() => setShowSettings(false)} className="mr-2">取消</Button>
          <Button type="primary" onClick={handleSave}>保存</Button>
        </div>
      </div>
    </Modal>
  )
}
