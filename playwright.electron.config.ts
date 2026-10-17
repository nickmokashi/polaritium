import { defineConfig } from '@playwright/test'

// Tests of the real desktop app (built main process, preload and page), run with hidden
// windows and a throwaway data folder, so nothing appears on screen or touches real saves.
export default defineConfig({
  testDir: 'e2e-electron',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  outputDir: 'test-results/electron'
})
