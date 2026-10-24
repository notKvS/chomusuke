import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/preload/index.ts'),
          'ext-host': resolve('src/preload/ext-host.ts')
        },
        // Sandboxed preloads must be CommonJS.
        output: { format: 'cjs', entryFileNames: '[name].cjs' }
      }
    }
  },
  renderer: {
    plugins: [react()],
    build: {
      // Keep fonts/images as files: the CSP doesn't allow data: URLs.
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: resolve('src/renderer/index.html'),
          'ext-host': resolve('src/renderer/ext-host.html')
        }
      }
    }
  }
})
