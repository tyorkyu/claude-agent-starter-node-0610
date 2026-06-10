import { defineConfig, type PluginOption } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react() as PluginOption]
})
