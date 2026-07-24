export interface LLMConfig {
  baseURL: string
  apiKey: string
  modelName: string
}

export const DEFAULT_LLM_CONFIG: LLMConfig = {
  baseURL: 'https://api.deepseek.com',
  apiKey: '',
  modelName: 'deepseek-chat'
}
