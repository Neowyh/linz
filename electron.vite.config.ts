import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

// Node 18+ 全局 API polyfill，注入到 bundle 顶部，确保在 @langchain/core 等依赖加载前执行
const nodePolyfillBanner = `
;(function () {
  var streamWeb = require('stream/web')
  if (!globalThis.ReadableStream) globalThis.ReadableStream = streamWeb.ReadableStream
  if (!globalThis.WritableStream) globalThis.WritableStream = streamWeb.WritableStream
  if (!globalThis.TransformStream) globalThis.TransformStream = streamWeb.TransformStream
  if (!globalThis.Blob) globalThis.Blob = require('buffer').Blob
  if (!globalThis.structuredClone) {
    globalThis.structuredClone = function (o) {
      if (o === null || typeof o !== 'object') return o
      try { return JSON.parse(JSON.stringify(o)) } catch (e) { return o }
    }
  }
  if (!globalThis.TextEncoderStream) {
    var util = require('util')
    globalThis.TextEncoderStream = function TextEncoderStream() {
      var encoder = new util.TextEncoder()
      var controller = null
      this.readable = new streamWeb.ReadableStream({
        start: function (c) { controller = c }
      })
      Object.defineProperty(this, 'writable', {
        get: function () {
          return new streamWeb.WritableStream({
            write: function (chunk) {
              var encoded = encoder.encode(chunk)
              controller.enqueue(encoded)
            },
            close: function () { controller.close() },
            abort: function (e) { controller.error(e) }
          })
        }
      })
    }
  }
  if (!globalThis.TextDecoderStream) {
    var util2 = require('util')
    globalThis.TextDecoderStream = function TextDecoderStream() {
      var decoder = new util2.TextDecoder()
      var controller = null
      this.readable = new streamWeb.ReadableStream({
        start: function (c) { controller = c }
      })
      Object.defineProperty(this, 'writable', {
        get: function () {
          return new streamWeb.WritableStream({
            write: function (chunk) {
              var decoded = decoder.decode(chunk, { stream: true })
              if (decoded) controller.enqueue(decoded)
            },
            close: function () {
              var final = decoder.decode()
              if (final) controller.enqueue(final)
              controller.close()
            },
            abort: function (e) { controller.error(e) }
          })
        }
      })
    }
  }
})()
`

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        external: [
          '@xenova/transformers',
          '@modelcontextprotocol/sdk',
          '@langchain/mcp-adapters',
          'node-pty',
          '@earendil-works/pi-coding-agent'
        ],
        output: {
          banner: nodePolyfillBanner
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    base: './',
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react()],
    css: {
      postcss: './postcss.config.js'
    }
  }
})
