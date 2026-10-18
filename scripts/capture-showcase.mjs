// Photographs the game for the public showcase (showcase/screenshots). Headless only: the built
// game page (out/renderer) is served on this computer and driven in a headless Microsoft Edge,
// so nothing ever appears on screen. Run `npm run build` first, then
//   node scripts/capture-showcase.mjs
// Look at every picture before pushing the showcase.
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const out = resolve(root, 'showcase', 'screenshots')
const PORT = 4797
const base = `http://127.0.0.1:${PORT}`
const viewport = { width: 1600, height: 900 }

async function waitForServer() {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${base}/index.html`)).ok) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error('the game page server did not start')
}

async function start(page, env, preset) {
  await page.goto(`${base}/index.html`)
  await page.getByTestId('menu-new').click()
  await page.getByTestId(`env-${env}`).click()
  await page.getByTestId(`preset-${preset}`).click()
  await page.getByTestId('start-experiment').click()
  await page.getByTestId('tool-rail').waitFor({ state: 'visible', timeout: 20_000 })
  const skip = page.getByTestId('tutorial').getByRole('button')
  if (await skip.isVisible().catch(() => false)) await skip.click()
  await page.mouse.move(viewport.width - 40, viewport.height / 2)
}

async function run(page, seconds) {
  await page.getByRole('button', { name: '8×' }).click()
  await page.waitForTimeout(seconds * 1000)
}

const shot = (page, name) =>
  page.screenshot(name.endsWith('.jpg') ? { path: resolve(out, name), type: 'jpeg', quality: 90 } : { path: resolve(out, name) })

// The pictures the showcase README uses, in its order. Change this list and the README together.
const scenes = [
  ['menu', async (page) => {
    await page.goto(`${base}/index.html`)
    await page.getByTestId('main-menu').waitFor()
    await page.waitForTimeout(3000)
    await shot(page, '01-menu.jpg')
  }],
  ['cathedral choir', async (page) => {
    await start(page, 'cathedral', 'choir')
    await run(page, 20)
    await shot(page, '02-resonance-cathedral.jpg')
    await page.keyboard.press('Tab')
    await page.waitForTimeout(900)
    await shot(page, '03-strand-sight.jpg')
  }],
  ['threshold shoal', async (page) => {
    await start(page, 'threshold', 'shoal')
    await run(page, 20)
    await shot(page, '04-threshold-life.jpg')
  }],
  ['well orchard', async (page) => {
    // Crystals need a few minutes of game time in still light before they show.
    await start(page, 'well', 'orchard')
    await run(page, 75)
    await shot(page, '05-crystal-orchard.jpg')
  }],
  ['garden scatter', async (page) => {
    await start(page, 'garden', 'scatter')
    await run(page, 20)
    await shot(page, '06-fracture-garden.jpg')
  }],
  ['chambers', async (page) => {
    await page.goto(`${base}/index.html`)
    await page.getByTestId('menu-chambers').click()
    await page.getByTestId('chambers').waitFor()
    await page.waitForTimeout(1200)
    await shot(page, '07-paradox-chambers.png')
  }],
  ['ai budget', async (page) => {
    await page.goto(`${base}/index.html`)
    await page.getByTestId('menu-settings').click()
    await page.getByTestId('settings-budget').click()
    await page.getByTestId('budget-dashboard').waitFor()
    await page.waitForTimeout(1000)
    await shot(page, '08-ai-budget.png')
  }]
]

const only = process.argv.slice(2)
await mkdir(out, { recursive: true })
const server = spawn(process.execPath, [resolve(root, 'scripts', 'serve-web.mjs'), '--port', String(PORT)], { stdio: 'ignore' })
let failed = 0
try {
  await waitForServer()
  const browser = await chromium.launch({
    channel: 'msedge',
    headless: true,
    args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required']
  })
  for (const [name, fn] of scenes) {
    if (only.length && !only.includes(name)) continue
    // A neutral time zone, so the AI budget screen does not show this computer's region.
    const context = await browser.newContext({ viewport, timezoneId: 'UTC', locale: 'en-US' })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (e) => errors.push(e.message))
    try {
      await fn(page)
      console.log(`${name}: ok${errors.length ? ` (page errors: ${errors.join(' | ')})` : ''}`)
      if (errors.length) failed++
    } catch (e) {
      failed++
      console.log(`${name}: FAILED ${e.message.split('\n')[0]}`)
    }
    await context.close()
  }
  await browser.close()
} finally {
  server.kill()
}
process.exit(failed ? 1 : 0)
