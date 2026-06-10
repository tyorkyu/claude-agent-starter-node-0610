import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react() as PluginOption],
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        sandboxBench: resolve(__dirname, 'sandbox-bench.html'),
      },
    },
  },
})
