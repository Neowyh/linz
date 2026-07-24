import { ChatOpenAI } from '@langchain/openai'
import { getAppConfig } from '../store/app-config'
import type { LLMConfig } from './deepseek'
import { DEFAULT_LLM_CONFIG } from './deepseek'

export { withRetry } from './retry'
export type { RetryOptions } from './retry'
export { compressContext, estimateTokens, estimateMessagesTokens } from './context-compressor'

export function getLLMConfig(): LLMConfig {
  const config = getAppConfig()
  return {
    baseURL: config.get('baseURL') || DEFAULT_LLM_CONFIG.baseURL,
    apiKey: config.get('apiKey') || DEFAULT_LLM_CONFIG.apiKey,
    modelName: config.get('modelName') || DEFAULT_LLM_CONFIG.modelName
  }
}

export interface CreateChatModelOptions extends Partial<LLMConfig> {
  timeout?: number
  fallbackModel?: string
}

export function createChatModel(overrides?: CreateChatModelOptions): ChatOpenAI {
  const { timeout, fallbackModel, ...llmOverrides } = overrides || {}
  const config = { ...getLLMConfig(), ...llmOverrides }
  return new ChatOpenAI({
    modelName: config.modelName,
    temperature: 0.7,
    streaming: true,
    timeout: timeout ?? 60000,
    apiKey: config.apiKey,
    configuration: {
      baseURL: config.baseURL
    }
  })
}

export function createFallbackModel(fallbackModel?: string): ChatOpenAI | null {
  const modelName = fallbackModel || getAppConfig().get('fallbackModel')
  if (!modelName) return null

  const config = getLLMConfig()
  return new ChatOpenAI({
    modelName,
    temperature: 0.7,
    streaming: true,
    timeout: 60000,
    apiKey: config.apiKey,
    configuration: {
      baseURL: config.baseURL
    }
  })
}

export function createOllamaModel(): ChatOpenAI {
  const ollama = getAppConfig().get('ollama')
  return new ChatOpenAI({
    modelName: ollama?.modelName || 'qwen2.5:7b',
    temperature: 0.7,
    streaming: true,
    timeout: 120000,
    apiKey: 'ollama',
    configuration: {
      baseURL: (ollama?.baseURL || 'http://localhost:11434') + '/v1'
    }
  })
}

export interface ModelStatus {
  provider: 'cloud' | 'ollama' | 'offline'
  modelName: string
  label: string
}

export function getActiveModelStatus(): ModelStatus {
  const ollama = getAppConfig().get('ollama')
  if (ollama?.enabled) {
    return { provider: 'ollama', modelName: ollama.modelName, label: `Ollama (${ollama.modelName})` }
  }
  const config = getLLMConfig()
  if (config.apiKey) {
    return { provider: 'cloud', modelName: config.modelName, label: config.modelName }
  }
  return { provider: 'offline', modelName: '', label: '离线' }
}

export async function isOllamaAvailable(): Promise<boolean> {
  const ollama = getAppConfig().get('ollama')
  const baseURL = ollama?.baseURL || 'http://localhost:11434'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 5000)
    const resp = await fetch(baseURL + '/api/tags', { signal: controller.signal })
    clearTimeout(timeout)
    return resp.ok
  } catch {
    return false
  }
}
