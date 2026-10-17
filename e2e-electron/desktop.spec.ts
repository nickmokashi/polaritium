import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// The desktop app as a player gets it: the real main process, its SQLite store, its key
// storage and its one AI sender (with a pretend Claude), behind the locked-down page.

const ROOT = resolve(__dirname, '..')
const EXE = process.env.POLARITIUM_EXE || join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const packaged = !!process.env.POLARITIUM_EXE

async function launch(dataDir: string, extraArgs: string[] = [], env: Record<string, string> = {}): Promise<{ app: ElectronApplication; page: Page }> {
  const args = packaged ? [`--user-data-dir=${dataDir}`, ...extraArgs] : [ROOT, `--user-data-dir=${dataDir}`, ...extraArgs]
  const app = await electron.launch({ executablePath: EXE, args, env: { ...process.env, POLARITIUM_HIDDEN: '1', ...env } as Record<string, string> })
  const page = await app.firstWindow()
  await page.waitForLoadState('domcontentloaded')
  return { app, page }
}

test('the page is locked down: desktop bridge, no network, no key exposed', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polaritium-e2e-'))
  const { app, page } = await launch(dir)
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30000 })
  expect(await page.evaluate(() => (window as any).polaritium?.kind)).toBe('desktop')
  expect(await page.evaluate(() => typeof (window as any).require)).toBe('undefined')
  const net = await page.evaluate(async () => {
    try {
      await fetch('https://api.anthropic.com/v1/models')
      return 'reached'
    } catch {
      return 'blocked'
    }
  })
  expect(net).toBe('blocked')
  const surface = await page.evaluate(() => JSON.stringify(Object.keys((window as any).polaritium.ai)))
  expect(surface).not.toMatch(/getKey|readKey|key"/)
  await app.close()
})

test('a saved universe and the settings survive a restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polaritium-e2e-'))
  let { app, page } = await launch(dir)
  await page.getByTestId('menu-new').click()
  await page.getByTestId('start-experiment').click()
  await expect(page.getByTestId('tool-rail')).toBeVisible({ timeout: 30000 })
  await page.waitForTimeout(1500)
  await page.getByTestId('save').click()
  await page.waitForTimeout(1500)
  const saved = await page.evaluate(() => (window as any).polaritium.universes.list())
  expect(saved.length).toBe(1)
  await page.evaluate(async () => {
    const b = (window as any).polaritium
    const s = await b.settings.get()
    await b.settings.set({ ...s, audio: { ...s.audio, master: 0.42 } })
  })
  await app.close()
  expect(existsSync(join(dir, 'polaritium.db'))).toBe(true)
  ;({ app, page } = await launch(dir))
  await expect(page.getByTestId('menu-continue')).toBeEnabled({ timeout: 30000 })
  expect(await page.evaluate(async () => (await (window as any).polaritium.settings.get()).audio.master)).toBe(0.42)
  await page.getByTestId('menu-continue').click()
  await expect(page.getByTestId('tool-rail')).toBeVisible({ timeout: 30000 })
  await app.close()
})

test('the Claude key is stored encrypted and never returned to the page', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polaritium-e2e-'))
  const { app, page } = await launch(dir)
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30000 })
  const fake = `sk-ant-test-${'x'.repeat(40)}`
  const r = await page.evaluate((k) => (window as any).polaritium.ai.setKey(k), fake)
  expect(r.ok).toBe(true)
  const status = await page.evaluate(() => (window as any).polaritium.ai.status())
  expect(status.keyPresent).toBe(true)
  expect(JSON.stringify(status)).not.toContain('sk-ant')
  const secret = join(dir, 'secrets', 'claude.key.bin')
  expect(existsSync(secret)).toBe(true)
  expect(readFileSync(secret).toString('latin1')).not.toContain('sk-ant')
  // nothing else in the data folder holds it in plain text
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    try {
      expect(readFileSync(p).toString('latin1')).not.toContain(fake)
    } catch {
      /* folders */
    }
  }
  const bad = await page.evaluate(() => (window as any).polaritium.ai.setKey('not-a-key'))
  expect(bad.ok).toBe(false)
  await page.evaluate(() => (window as any).polaritium.ai.clearKey())
  expect(existsSync(secret)).toBe(false)
  await app.close()
})

test('AI through the real desktop path: off by default, $10, confirmation to raise, pretend Claude, ledger on disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polaritium-e2e-'))
  let { app, page } = await launch(dir, ['--selftest=ipc'], { POLARITIUM_AI_MOCK: '1' })
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30000 })
  const b = (fn: string, ...args: unknown[]) => page.evaluate(([f, a]) => f.split('.').reduce((o: any, k: string) => o[k], (window as any).polaritium)(...(a as unknown[])), [fn, args] as const)
  const v0 = await b('ai.budget.view')
  expect(v0.limits.monthly).toBe(10_000_000)
  expect(v0.aiEnabled).toBe(false)
  const off = await b('ai.run', 'interpret', { summary: { light: 1 } }, { userInitiated: true })
  expect(off.ok).toBe(false)
  expect(off.reason).toBe('ai_off')
  const raise = await b('ai.budget.propose', { limits: { monthly: 20_000_000 } })
  expect(raise.status).toBe('needs_confirmation')
  expect((await b('ai.budget.view')).limits.monthly).toBe(10_000_000)
  await b('ai.setEnabled', true)
  const out = await b('ai.run', 'interpret', { summary: { light: 1, dark: 1 } }, { userInitiated: true })
  expect(out.ok).toBe(true)
  expect(out.text).toContain('test reply')
  const again = await b('ai.run', 'interpret', { summary: { light: 1, dark: 1 } }, { userInitiated: true })
  expect(again.cached).toBe(true)
  const notAsked = await b('ai.run', 'interpret', { summary: { light: 2 } }, { userInitiated: false })
  expect(notAsked.reason).toBe('not_user_initiated')
  const ledger = await b('ai.budget.ledger', 10)
  expect(ledger.length).toBe(1)
  expect(ledger[0].status).toBe('reconciled')
  await b('ai.setEnabled', false)
  await app.close()
  ;({ app, page } = await launch(dir, ['--selftest=ipc'], { POLARITIUM_AI_MOCK: '1' }))
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30000 })
  const after = await page.evaluate(() => (window as any).polaritium.ai.budget.ledger(10))
  expect(after.length).toBe(1)
  const view = await page.evaluate(() => (window as any).polaritium.ai.budget.view())
  expect(view.aiEnabled).toBe(false)
  expect(view.spentMonth).toBe(after[0].actual)
  await app.close()
})

test('with the window not in use, no paid request is made even when AI is on', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'polaritium-e2e-'))
  const { app, page } = await launch(dir, [], { POLARITIUM_AI_MOCK: '1' })
  await expect(page.getByTestId('main-menu')).toBeVisible({ timeout: 30000 })
  await page.evaluate(() => (window as any).polaritium.ai.setEnabled(true))
  const r = await page.evaluate(() => (window as any).polaritium.ai.run('interpret', { summary: { light: 1 } }, { userInitiated: true }))
  expect(r.ok).toBe(false)
  expect(r.reason).toBe('not_user_initiated')
  expect((await page.evaluate(() => (window as any).polaritium.ai.budget.ledger(10))).length).toBe(0)
  await app.close()
})
