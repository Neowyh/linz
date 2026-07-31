// 解析 worker：在 utilityProcess 中独立运行，避免大文件解析阻塞主进程
// 协议：主进程 postMessage({ id, filePath }) → 本进程回 { id, content, metadata, error }
import { parseFile } from '../parsers'

interface ParseRequest {
  id: number
  filePath: string
}

// utilityProcess 中通过 process.parentPort 与主进程通信
const parentPort = (process as unknown as { parentPort: Electron.ParentPort }).parentPort

parentPort.on('message', async (e: { data: ParseRequest }) => {
  const { id, filePath } = e.data
  try {
    const result = await parseFile(filePath, { fullText: true })
    parentPort.postMessage({
      id,
      content: result.content,
      metadata: result.metadata,
      error: result.error
    })
  } catch (err: unknown) {
    parentPort.postMessage({ id, content: '', error: err instanceof Error ? err.message : String(err) })
  }
})
