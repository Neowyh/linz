// Pi SDK 模型上下文：支持 DeepSeek + Ollama 两个 provider
//
// Pi 没有内置 DeepSeek/Ollama provider，需要通过 models.json 注册为 OpenAI-compatible。
// API key 从 app-config.ts 读取，通过 setRuntimeApiKey 注入（不持久化到 Pi 的 auth.json）。
// Ollama 不需要 API key，但走同样的 OpenAI-compatible 接口（/v1）。

import { app } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { getAppConfig } from '../store/app-config'
import { ensurePi } from './index'
import { isOllamaAvailable } from '../llm'

export type PiProvider = 'deepseek' | 'ollama'

export interface ModelContext {
  authStorage: any
  modelRegistry: any
  model: any
  provider: PiProvider
}

let cached: ModelContext | null = null
let cachedKey: string | null = null

function getPiConfigDir(): string {
  const dir = path.join(app.getPath('userData'), 'pi-config')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

interface ProviderSpec {
  id: string
  baseURL: string
  modelName: string
  apiKey: string
  apiKind: string
  compat?: Record<string, any>
  contextWindow: number
  maxTokens: number
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

function resolveProviderSpec(provider: PiProvider): ProviderSpec {
  const config = getAppConfig()
  if (provider === 'ollama') {
    const ollama = config.get('ollama')
    return {
      id: 'ollama',
      baseURL: (ollama?.baseURL || 'http://localhost:11434') + '/v1',
      modelName: ollama?.modelName || 'qwen2.5:7b',
      apiKey: 'ollama',
      apiKind: 'openai-completions',
      contextWindow: 32768,
      maxTokens: 4096,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }
  }
  return {
    id: 'deepseek',
    baseURL: config.get('baseURL') || 'https://api.deepseek.com',
    modelName: config.get('modelName') || 'deepseek-chat',
    apiKey: config.get('apiKey') || '',
    apiKind: 'openai-completions',
    compat: { thinkingFormat: 'deepseek' },
    contextWindow: 64000,
    maxTokens: 8192,
    cost: { input: 0.27, output: 1.1, cacheRead: 0.07, cacheWrite: 0.27 }
  }
}

function writeModelsJson(configDir: string, specs: ProviderSpec[]): string {
  const modelsJsonPath = path.join(configDir, 'models.json')
  const providers: Record<string, any> = {}
  for (const spec of specs) {
    providers[spec.id] = {
      baseUrl: spec.baseURL,
      api: spec.apiKind,
      ...(spec.compat ? { compat: spec.compat } : {}),
      models: [
        {
          id: spec.modelName,
          name: `${spec.id} ${spec.modelName}`,
          reasoning: false,
          input: ['text'],
          contextWindow: spec.contextWindow,
          maxTokens: spec.maxTokens,
          cost: spec.cost
        }
      ]
    }
  }
  fs.writeFileSync(modelsJsonPath, JSON.stringify({ providers }, null, 2), 'utf-8')
  return modelsJsonPath
}

// 默认同时注册 DeepSeek + Ollama，运行时可切换 model
async function buildModelContext(): Promise<ModelContext> {
  const config = getAppConfig()
  const deepseekSpec = resolveProviderSpec('deepseek')
  if (!deepseekSpec.apiKey) {
    throw new Error('DeepSeek API key not configured')
  }

  const specs: ProviderSpec[] = [deepseekSpec]

  // Ollama 可用就一起注册（用作 fallback）
  let ollamaEnabled = false
  try {
    const ollamaCfg = config.get('ollama')
    if (ollamaCfg?.enabled) {
      ollamaEnabled = await isOllamaAvailable()
    }
  } catch {
    ollamaEnabled = false
  }
  if (ollamaEnabled) {
    specs.push(resolveProviderSpec('ollama'))
  }

  const pi = await ensurePi()
  const configDir = getPiConfigDir()
  const authJsonPath = path.join(configDir, 'auth.json')
  const modelsJsonPath = writeModelsJson(configDir, specs)

  const authStorage = pi.AuthStorage.create(authJsonPath)
  authStorage.setRuntimeApiKey('deepseek', deepseekSpec.apiKey)
  if (ollamaEnabled) {
    authStorage.setRuntimeApiKey('ollama', 'ollama')
  }

  const modelRegistry = pi.ModelRegistry.create(authStorage, modelsJsonPath)
  const model = modelRegistry.find('deepseek', deepseekSpec.modelName)
  if (!model) {
    throw new Error(`Failed to resolve DeepSeek model: ${deepseekSpec.modelName}`)
  }

  return {
    authStorage,
    modelRegistry,
    model,
    provider: 'deepseek'
  }
}

export async function getModelContext(): Promise<ModelContext> {
  const config = getAppConfig()
  const apiKey = config.get('apiKey') || ''
  const baseURL = config.get('baseURL') || 'https://api.deepseek.com'
  const modelName = config.get('modelName') || 'deepseek-chat'
  const ollamaEnabled = config.get('ollama')?.enabled ? 'on' : 'off'
  const key = `${apiKey}|${baseURL}|${modelName}|${ollamaEnabled}`

  if (cached && cachedKey === key) {
    return cached
  }

  cached = await buildModelContext()
  cachedKey = key
  console.log(`[Pi] Model context ready: deepseek/${modelName} (ollama=${ollamaEnabled})`)
  return cached
}

// 切换到 Ollama model（主模型失败时回退）
export async function getOllamaModelContext(): Promise<ModelContext> {
  const ctx = await getModelContext()
  const ollamaSpec = resolveProviderSpec('ollama')
  const ollamaModel = ctx.modelRegistry.find('ollama', ollamaSpec.modelName)
  if (!ollamaModel) {
    throw new Error(`Failed to resolve Ollama model: ${ollamaSpec.modelName}`)
  }
  return {
    authStorage: ctx.authStorage,
    modelRegistry: ctx.modelRegistry,
    model: ollamaModel,
    provider: 'ollama'
  }
}

export async function isOllamaRegistered(): Promise<boolean> {
  try {
    const ctx = await getModelContext()
    const ollamaSpec = resolveProviderSpec('ollama')
    return !!ctx.modelRegistry.find('ollama', ollamaSpec.modelName)
  } catch {
    return false
  }
}

export function invalidateModelContext(): void {
  cached = null
  cachedKey = null
}

// 向后兼容旧导出名
export { getModelContext as getDeepSeekModelContext, invalidateModelContext as invalidateDeepSeekModelContext }
