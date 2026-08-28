// Electron 22 的 Node 16 无全局 ReadableStream（langchain 依赖）。独立文件确保最先执行。
import { ReadableStream, WritableStream, TransformStream } from 'stream/web'
;(globalThis as any).ReadableStream ??= ReadableStream
;(globalThis as any).WritableStream ??= WritableStream
;(globalThis as any).TransformStream ??= TransformStream
