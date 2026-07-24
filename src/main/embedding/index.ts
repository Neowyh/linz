const EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2'

let embedder: any | null = null
let isLoading = false
let loadError: string | null = null
let transformersAvailable: boolean | null = null

type FeatureExtractionPipeline = any

async function loadTransformers(): Promise<{ pipeline: (task: string, model: string, options?: any) => Promise<FeatureExtractionPipeline> }> {
  // @xenova/transformers is ESM-only, must use dynamic import in CJS Electron main process
  // @vite-ignore prevents Vite from trying to resolve this at build time
  const mod = await import(/* @vite-ignore */ '@xenova/transformers')
  return mod
}

async function ensureModel(): Promise<FeatureExtractionPipeline> {
  if (embedder) return embedder

  // If we already know transformers is not available, skip
  if (transformersAvailable === false) {
    throw new Error('Embedding module not available: @xenova/transformers is not installed. Install it with: npm install @xenova/transformers')
  }

  if (isLoading) {
    while (isLoading) {
      await new Promise((r) => setTimeout(r, 100))
    }
    if (embedder) return embedder
    throw new Error(`Embedding model failed to load: ${loadError}`)
  }

  isLoading = true
  loadError = null
  try {
    const { pipeline } = await loadTransformers()
    transformersAvailable = true
    embedder = await pipeline('feature-extraction', EMBEDDING_MODEL, {
      quantized: true
    })
    console.log(`[Embedding] Model loaded: ${EMBEDDING_MODEL}`)
    return embedder
  } catch (err: any) {
    transformersAvailable = false
    loadError = err?.message || String(err)
    console.warn('[Embedding] Failed to load model (embedding search will fall back to BM25):', loadError)
    throw err
  } finally {
    isLoading = false
  }
}

export async function getEmbedding(text: string): Promise<number[]> {
  const model = await ensureModel()
  const output = await model(text, { pooling: 'mean', normalize: true })
  return Array.from(output.data) as number[]
}

export function isEmbeddingReady(): boolean {
  if (transformersAvailable === false) return false
  return embedder !== null
}

export function getEmbeddingStatus(): { ready: boolean; loading: boolean; error: string | null; available: boolean } {
  return {
    ready: embedder !== null,
    loading: isLoading,
    error: loadError,
    available: transformersAvailable !== false
  }
}
