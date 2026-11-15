import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'

const version = JSON.parse(readFileSync('./package.json', 'utf8')).version as string

export default defineConfig({
  plugins: [react()],
  define: { __VERSION__: JSON.stringify(version) },
  clearScreen: false,
  server: { port: 1420, strictPort: true, host: '127.0.0.1' },
  build: { target: 'es2021', sourcemap: false },
})
