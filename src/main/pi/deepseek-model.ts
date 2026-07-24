// 旧文件名兼容层，实际逻辑已迁移到 model-context.ts
export {
  getModelContext as getDeepSeekModelContext,
  getOllamaModelContext,
  isOllamaRegistered,
  invalidateModelContext as invalidateDeepSeekModelContext,
  type ModelContext as DeepSeekModelContext,
  type PiProvider
} from './model-context'
