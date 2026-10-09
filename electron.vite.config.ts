import { defineConfig } from 'electron-vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Smart selection: ship the ONNX Runtime Web WebGPU/WASM runtime next to the renderer (out/renderer/ort/), loaded by URL from a Worker. */
const ORT_FILES = ['ort-wasm-simd-threaded.jsep.mjs', 'ort-wasm-simd-threaded.jsep.wasm']
const ortAssets = (): import('vite').Plugin => ({
  name: 'wincreative-ort-assets',
  generateBundle() {
    for (const f of ORT_FILES) this.emitFile({ type: 'asset', fileName: `ort/${f}`, source: readFileSync(resolve('node_modules/onnxruntime-web/dist', f)) })
  },
  configureServer(server) {
    server.middlewares.use('/ort/', (req, res, next) => {
      const name = (req.url ?? '').replace(/^\//, '').split('?')[0]
      if (!ORT_FILES.includes(name)) return next()
      res.setHeader('Content-Type', name.endsWith('.wasm') ? 'application/wasm' : 'text/javascript')
      res.end(readFileSync(resolve('node_modules/onnxruntime-web/dist', name)))
    })
  }
})

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: { target: 'chrome130' },
    // onnxruntime-web: the build that loads its wasm glue from a URL (our CSP only allows 'self' scripts, no blob: workers)
    resolve: { conditions: ['onnxruntime-web-use-extern-wasm'] },
    worker: { format: 'es' },
    plugins: [ortAssets()]
  }
})
