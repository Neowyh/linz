import { useEffect, useState, useCallback } from 'react'
import { Button, Input, Switch, Progress, Tag, message, Alert, Spin, Divider, Upload } from 'antd'
import { SyncOutlined, DownloadOutlined, ReloadOutlined, CheckCircleOutlined, FolderOpenOutlined, InboxOutlined } from '@ant-design/icons'

type UpdateStatus = 'idle' | 'checking' | 'downloading' | 'ready' | 'error'

interface UpdateInfo {
  latestVersion: string
  totalDownloadSize: number
  totalDownloadSizeFormatted?: string
  fileCount: number
  changelog?: string
}

interface DownloadProgressData {
  fileName: string
  downloaded: number
  total: number
  fileIndex: number
  fileCount: number
  totalDownloaded: number
  totalSize: number
  percent: number
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export default function UpdateSettingsPanel(): JSX.Element {
  const [currentVersion, setCurrentVersion] = useState('...')
  const [serverUrl, setServerUrl] = useState('')
  const [autoCheck, setAutoCheck] = useState(true)
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null)
  const [progress, setProgress] = useState<DownloadProgressData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [offlineApplying, setOfflineApplying] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [offlineError, setOfflineError] = useState<string | null>(null)
  const [offlineVersionInfo, setOfflineVersionInfo] = useState<{ fromVersion: string; toVersion: string } | null>(null)

  // 初始加载配置
  useEffect(() => {
    const loadConfig = async (): Promise<void> => {
      try {
        const [version, url, autoCheckVal] = await Promise.all([
          window.aeromind.update.getCurrentVersion(),
          window.aeromind.settings.get('updateServerUrl'),
          window.aeromind.settings.get('updateAutoCheck')
        ])
        setCurrentVersion(version)
        setServerUrl(url || '')
        setAutoCheck(autoCheckVal !== false)
      } catch (err) {
        console.error('Failed to load update config:', err)
      }
    }
    loadConfig()
  }, [])

  // 订阅下载进度
  useEffect(() => {
    const unsubProgress = window.aeromind.update.onDownloadProgress((data: DownloadProgressData) => {
      setProgress(data)
      setStatus('downloading')
    })
    const unsubComplete = window.aeromind.update.onDownloadComplete(() => {
      setStatus('ready')
      setProgress(null)
    })
    const unsubAvailable = window.aeromind.update.onUpdateAvailable((data: any) => {
      setUpdateInfo({
        latestVersion: data.latestVersion,
        totalDownloadSize: data.totalDownloadSize,
        totalDownloadSizeFormatted: data.totalDownloadSizeFormatted || formatBytes(data.totalDownloadSize),
        fileCount: data.fileCount,
        changelog: data.changelog
      })
      setStatus('idle')
    })
    return () => {
      unsubProgress()
      unsubComplete()
      unsubAvailable()
    }
  }, [])

  const handleServerUrlChange = async (value: string): Promise<void> => {
    setServerUrl(value)
    await window.aeromind.settings.set('updateServerUrl', value)
  }

  const handleAutoCheckChange = async (checked: boolean): Promise<void> => {
    setAutoCheck(checked)
    await window.aeromind.settings.set('updateAutoCheck', checked)
  }

  const handleCheck = async (): Promise<void> => {
    if (!serverUrl) {
      message.warning('请先填写更新服务器地址')
      return
    }
    setLoading(true)
    setStatus('checking')
    setError(null)
    try {
      const result = await window.aeromind.update.checkForUpdates()
      if (result.available) {
        setUpdateInfo({
          latestVersion: result.latestVersion,
          totalDownloadSize: result.totalDownloadSize,
          totalDownloadSizeFormatted: result.totalDownloadSizeFormatted || formatBytes(result.totalDownloadSize),
          fileCount: result.files?.length || 0,
          changelog: result.changelog
        })
        message.success(`发现新版本 ${result.latestVersion}`)
      } else {
        setUpdateInfo(null)
        message.info('当前已是最新版本')
      }
      setStatus('idle')
    } catch (err) {
      setError(String(err))
      setStatus('error')
    } finally {
      setLoading(false)
    }
  }

  const handleDownload = async (): Promise<void> => {
    setStatus('downloading')
    setError(null)
    setProgress(null)
    try {
      const result = await window.aeromind.update.downloadUpdate()
      if (!result.success) {
        setError(result.error || '下载失败')
        setStatus('error')
      }
    } catch (err) {
      setError(String(err))
      setStatus('error')
    }
  }

  const handleRestart = async (): Promise<void> => {
    await window.aeromind.update.applyAndRestart()
  }

  const handlePickPatch = async (): Promise<void> => {
    setOfflineError(null)
    setOfflineReady(false)
    setOfflineVersionInfo(null)
    const filePath = await window.aeromind.update.pickPatchFile()
    if (!filePath) return

    setOfflineApplying(true)
    try {
      const result = await window.aeromind.update.applyOfflinePatch(filePath)
      if (result.success) {
        setOfflineReady(true)
        setOfflineVersionInfo({ fromVersion: result.fromVersion || '', toVersion: result.toVersion || '' })
        message.success('补丁已提取，需要重启以完成更新')
      } else {
        setOfflineError(result.error || '补丁应用失败')
      }
    } catch (err) {
      setOfflineError(String(err))
    } finally {
      setOfflineApplying(false)
    }
  }

  const handleDropPatch = useCallback(async (filePath: string): Promise<void> => {
    setOfflineError(null)
    setOfflineReady(false)
    setOfflineVersionInfo(null)
    setOfflineApplying(true)
    try {
      const result = await window.aeromind.update.applyOfflinePatch(filePath)
      if (result.success) {
        setOfflineReady(true)
        setOfflineVersionInfo({ fromVersion: result.fromVersion || '', toVersion: result.toVersion || '' })
        message.success('补丁已提取，需要重启以完成更新')
      } else {
        setOfflineError(result.error || '补丁应用失败')
      }
    } catch (err) {
      setOfflineError(String(err))
    } finally {
      setOfflineApplying(false)
    }
  }, [])

  return (
    <div className="space-y-4">
      {/* 当前版本 */}
      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs text-gray-600">当前版本</label>
          <p className="text-sm font-medium text-gray-900 mt-0.5">
            v{currentVersion}
            {updateInfo && (
              <span className="ml-2 text-gray-400">
                → <span className="text-blue-600 font-medium">v{updateInfo.latestVersion}</span>
              </span>
            )}
          </p>
        </div>
        <Tag color={status === 'downloading' ? 'processing' : status === 'ready' ? 'success' : status === 'error' ? 'error' : 'default'}>
          {status === 'idle' ? '就绪' : status === 'checking' ? '检查中' : status === 'downloading' ? '下载中' : status === 'ready' ? '已就绪' : '错误'}
        </Tag>
      </div>

      {/* 更新服务器配置 */}
      <div>
        <label className="text-xs text-gray-600">更新服务器地址</label>
        <Input
          size="small"
          placeholder="https://your-server.com/linz-updates"
          value={serverUrl}
          onChange={(e) => handleServerUrlChange(e.target.value)}
          className="mt-1"
        />
        <p className="text-[11px] text-gray-400 mt-1">
          留空则禁用在线更新。地址指向包含 manifest.json 和 files/ 目录的根路径。
        </p>
      </div>

      {/* 自动检查 */}
      <div className="flex items-center justify-between">
        <div className="pr-4">
          <label className="text-xs text-gray-600">启动时自动检查更新</label>
          <p className="text-[11px] text-gray-400 mt-0.5">应用启动时后台检查，有新版本时通知。</p>
        </div>
        <Switch checked={autoCheck} onChange={handleAutoCheckChange} size="small" />
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2 pt-2">
        <Button
          size="small"
          icon={loading ? <Spin size="small" /> : <SyncOutlined />}
          onClick={handleCheck}
          disabled={loading || status === 'downloading'}
        >
          检查更新
        </Button>

        {updateInfo && status !== 'ready' && status !== 'downloading' && (
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            onClick={handleDownload}
          >
            下载更新（{updateInfo.totalDownloadSizeFormatted || formatBytes(updateInfo.totalDownloadSize)}）
          </Button>
        )}

        {status === 'downloading' && progress && (
          <span className="text-xs text-gray-500">
            {progress.fileIndex + 1}/{progress.fileCount} 文件 — {formatBytes(progress.totalDownloaded)} / {formatBytes(progress.totalSize)}
          </span>
        )}

        {status === 'ready' && (
          <Button
            size="small"
            type="primary"
            icon={<ReloadOutlined />}
            onClick={handleRestart}
          >
            重启以完成更新
          </Button>
        )}
      </div>

      {/* 下载进度条 */}
      {status === 'downloading' && progress && (
        <Progress
          percent={progress.percent}
          size="small"
          status="active"
          format={(p) => `${p}%`}
        />
      )}

      {/* 更新信息 */}
      {updateInfo && status !== 'downloading' && (
        <Alert
          type="info"
          showIcon
          icon={<CheckCircleOutlined />}
          message={`新版本 v${updateInfo.latestVersion} 可用`}
          description={
            <div className="space-y-1">
              <div className="text-xs text-gray-500">
                {updateInfo.fileCount} 个文件，共 {updateInfo.totalDownloadSizeFormatted || formatBytes(updateInfo.totalDownloadSize)}
              </div>
              {updateInfo.changelog && (
                <div className="text-xs text-gray-600 whitespace-pre-line">{updateInfo.changelog}</div>
              )}
            </div>
          }
        />
      )}

      {/* 错误提示 */}
      {error && (
        <Alert
          type="error"
          showIcon
          message="更新失败"
          description={error}
          closable
          onClose={() => setError(null)}
        />
      )}

      {/* 更新就绪提示 */}
      {status === 'ready' && (
        <Alert
          type="success"
          showIcon
          message="更新已下载完成"
          description={'点击"重启以完成更新"按钮，应用将关闭并重新启动以应用更新。'}
        />
      )}

      <Divider className="my-3" />

      {/* 离线补丁 */}
      <div>
        <h4 className="text-xs font-medium text-gray-700 mb-2">离线补丁</h4>
        <div className="flex items-center gap-2 mb-2">
          <Button
            size="small"
            icon={offlineApplying ? <Spin size="small" /> : <FolderOpenOutlined />}
            onClick={handlePickPatch}
            disabled={offlineApplying}
          >
            选择补丁包
          </Button>
          {offlineReady && (
            <Button
              size="small"
              type="primary"
              icon={<ReloadOutlined />}
              onClick={handleRestart}
            >
              重启以完成更新
            </Button>
          )}
        </div>

        {/* 拖放区域 */}
        <div
          className="border-2 border-dashed border-gray-200 rounded-lg p-3 text-center text-xs text-gray-400 transition-colors hover:border-blue-400 hover:text-blue-500"
          onDragOver={(e) => { e.preventDefault(); e.stopPropagation() }}
          onDrop={(e) => {
            e.preventDefault()
            e.stopPropagation()
            const files = e.dataTransfer?.files
            if (files && files.length > 0) {
              const file = files[0]
              const ext = file.name.split('.').pop()?.toLowerCase()
              if (ext === 'linzpatch' || ext === 'zip') {
                handleDropPatch((file as any).path)
              } else {
                message.warning('请选择 .linzpatch 或 .zip 文件')
              }
            }
          }}
        >
          <InboxOutlined className="text-lg mb-1" />
          <p>将 .linzpatch 文件拖放到此处</p>
        </div>

        {offlineError && (
          <Alert
            type="error"
            showIcon
            message="离线补丁失败"
            description={offlineError}
            closable
            onClose={() => setOfflineError(null)}
            className="mt-2"
          />
        )}

        {offlineReady && (
          <Alert
            type="success"
            showIcon
            message="补丁已提取完成"
            description={
              offlineVersionInfo
                ? `${offlineVersionInfo.fromVersion === '*' ? '此补丁包可从任意版本升级' : `从 v${offlineVersionInfo.fromVersion} 升级`}到 v${offlineVersionInfo.toVersion}。点击"重启以完成更新"按钮，应用将关闭并重新启动以应用补丁。`
                : '点击"重启以完成更新"按钮，应用将关闭并重新启动以应用补丁。'
            }
            className="mt-2"
          />
        )}
      </div>
    </div>
  )
}
