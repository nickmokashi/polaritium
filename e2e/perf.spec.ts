import { writeFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { QUALITY_PRESETS } from '../src/core/app/settings'

// Frames drawn per second at each graphics level, in headless Edge on this computer's own
// graphics chip. Headless Edge offers at most 60 frames a second, so 60 is the ceiling here;
// cpuMsPerFrame is the time the page spends preparing and sending each frame to the chip.

const results: Record<string, unknown>[] = []

for (const q of ['low', 'balanced', 'high', 'ultra'] as const) {
  for (const preset of ['shoal', 'scatter'] as const) {
    test(`frame rate: ${q}, ${preset}`, async ({ page }) => {
      await page.addInitScript((g) => {
        localStorage.setItem('polaritium.settings', JSON.stringify({ graphics: g }))
      }, QUALITY_PRESETS[q])
      await page.goto('/index.html?test')
      await page.getByTestId('menu-new').click()
      await page.getByTestId(`preset-${preset}`).click()
      await page.getByTestId('start-experiment').click()
      await expect(page.getByTestId('game')).toBeVisible()
      await page.waitForTimeout(3000)
      const f0 = await page.evaluate(() => (window as any).__pt.frames())
      const m0 = await page.evaluate(() => (window as any).__pt.frameMs())
      const t0 = Date.now()
      await page.waitForTimeout(6000)
      const f1 = await page.evaluate(() => (window as any).__pt.frames())
      const fps = ((f1 - f0) * 1000) / (Date.now() - t0)
      const m1 = await page.evaluate(() => (window as any).__pt.frameMs())
      const cpuMs = (m1.ms - m0.ms) / Math.max(1, m1.n - m0.n)
      const info = await page.evaluate(() => (window as any).__pt.entities())
      results.push({ quality: q, preset, fps: +fps.toFixed(1), cpuMsPerFrame: +cpuMs.toFixed(2), cap: QUALITY_PRESETS[q].fpsCap, nodes: info.nodes.length, organisms: info.organisms })
      expect(fps).toBeGreaterThan(QUALITY_PRESETS[q].fpsCap * 0.7)
    })
  }
}

test.afterAll(() => {
  console.table(results)
  writeFileSync('test-results/perf-fps.json', JSON.stringify(results, null, 2))
})
