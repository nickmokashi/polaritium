import { defineConfig } from '@playwright/test'

// The interface tests run the real renderer in a headless Microsoft Edge on this computer's
// own graphics chip, so nothing ever appears on screen. The renderer is served by
// scripts/serve-web.mjs from the built app (out/renderer), using the browser bridge.
const PORT = Number(process.env.POLARITIUM_PORT || 4791)

export default defineConfig({
  testDir: 'e2e',
  timeout: 120_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    channel: 'msedge',
    headless: true,
    viewport: { width: 1366, height: 768 },
    launchOptions: { args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] }
  },
  webServer: {
    command: `node scripts/serve-web.mjs --port ${PORT}`,
    url: `http://127.0.0.1:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 30_000
  }
})
