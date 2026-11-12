import { defineConfig } from '@playwright/test'

// Pruebas de interfaz contra `vite dev` y el servidor Subsonic falso (mock-server).
export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:1420',
    viewport: { width: 1280, height: 800 },
    locale: 'es-ES',
    launchOptions: {
      executablePath: process.env.CHROME_PATH || undefined,
      args: ['--autoplay-policy=no-user-gesture-required', '--mute-audio'],
    },
  },
  webServer: [
    { command: 'node mock-server/server.mjs', url: 'http://127.0.0.1:4533/rest/ping', reuseExistingServer: true, timeout: 30_000, ignoreHTTPSErrors: true },
    { command: 'npx vite --host 127.0.0.1', url: 'http://127.0.0.1:1420', reuseExistingServer: true, timeout: 60_000 },
  ],
})
