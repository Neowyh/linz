export interface RetryOptions {
  maxRetries?: number
  baseDelay?: number
  retryOn?: (error: any) => boolean
}

const DEFAULT_MAX_RETRIES = 3
const DEFAULT_BASE_DELAY = 1000

function isRetryableError(error: any): boolean {
  // Network-level errors
  const code = error?.code || error?.cause?.code || ''
  if (['ENOTFOUND', 'ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'ESOCKETTIMEDOUT'].includes(code)) {
    return true
  }

  // HTTP status errors
  const status = error?.status || error?.response?.status || error?.statusCode || 0
  // 429 rate limit or 5xx server errors
  if (status === 429 || (status >= 500 && status < 600)) {
    return true
  }

  // 4xx (non-429) are not retryable
  if (status >= 400 && status < 500) {
    return false
  }

  // AbortError is not retryable
  if (error?.name === 'AbortError') {
    return false
  }

  // Unknown errors without status code: retry (likely network issues)
  if (status === 0 && !code) {
    return true
  }

  return false
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: RetryOptions
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES
  const baseDelay = options?.baseDelay ?? DEFAULT_BASE_DELAY
  const retryOn = options?.retryOn ?? isRetryableError

  let lastError: any

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (attempt >= maxRetries || !retryOn(error)) {
        throw error
      }

      // Exponential backoff with jitter
      const delay = baseDelay * Math.pow(2, attempt) * (0.5 + Math.random() * 0.5)
      const errMsg = error instanceof Error ? error.message : String(error)
      console.warn(`[Retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${Math.round(delay)}ms...`, errMsg || error)

      await new Promise((resolve) => setTimeout(resolve, delay))
    }
  }

  throw lastError
}
