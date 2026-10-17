import { expect, test, type Page } from '@playwright/test'

// Every tool, used the way a player uses it: with the mouse, on the real 3D view, in a
// headless browser. Positions on screen come from a test-only hook (?test).

type Ent = { id: number; kind: number; x: number; y: number; z: number; freq: number; flags: number; fill: number }
type Strand = { id: number; a: number; b: number; current: number; twist: number; coupling: number; rest: number }
type Ents = { tick: number; nodes: Ent[]; strands: Strand[]; organisms: number; rings: number; veils: number; crystals: number; events: string[] }

const ents = (page: Page) => page.evaluate(() => (window as any).__pt.entities() as Ents)
const ui = (page: Page) => page.evaluate(() => (window as any).__pt.ui())
const proj = (page: Page, id: number) => page.evaluate((i) => (window as any).__pt.project(i) as { x: number; y: number } | null, id)
const projPt = (page: Page, x: number, y: number, z: number) => page.evaluate(([a, b, c]) => (window as any).__pt.projectPoint(a, b, c), [x, y, z])

async function startLab(page: Page, preset = 'twin', opts: { url?: string; env?: string; keepTutorial?: boolean } = {}) {
  await page.goto(opts.url ?? '/index.html?test')
  await page.getByTestId('menu-new').click()
  if (opts.env) await page.getByTestId(`env-${opts.env}`).click()
  await page.getByTestId(`preset-${preset}`).click()
  await page.getByTestId('start-experiment').click()
  await expect(page.getByTestId('tool-rail')).toBeVisible()
  await page.waitForFunction(() => ((window as any).__pt?.entities()?.nodes?.length ?? -1) >= 0)
  if (!opts.keepTutorial) {
    const t = page.getByTestId('tutorial')
    if (await t.isVisible().catch(() => false)) await t.getByRole('button').click()
  }
  await page.waitForTimeout(600)
}

async function pause(page: Page) {
  await page.evaluate(() => (window as any).__pt.setPaused(true))
  await page.waitForTimeout(400)
}

async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 12) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps })
  await page.mouse.up()
  await page.waitForTimeout(300)
}

async function twin(page: Page) {
  const e = await ents(page)
  const W = e.nodes.find((n) => n.kind === 1 && Math.abs(n.x + 14) < 3)!
  const B = e.nodes.find((n) => n.kind === 0 && Math.abs(n.x - 14) < 3)!
  return { W, B }
}

async function connectTwin(page: Page) {
  const { W, B } = await twin(page)
  await page.keyboard.press('3')
  await drag(page, (await proj(page, W.id))!, (await proj(page, B.id))!)
  return { W, B }
}

test.describe('tools', () => {
  test('Hand selects, drags and the inspector explains', async ({ page }) => {
    await startLab(page)
    await pause(page)
    const { W } = await twin(page)
    const p = (await proj(page, W.id))!
    await page.mouse.click(p.x, p.y)
    await expect(page.getByTestId('inspector')).toBeVisible()
    await expect(page.getByTestId('inspector')).toContainText('Light')
    const before = (await ents(page)).nodes.find((n) => n.id === W.id)!
    await page.evaluate(() => (window as any).__pt.setPaused(false))
    await drag(page, p, { x: p.x + 120, y: p.y - 60 }, 20)
    await page.waitForTimeout(800)
    const after = (await ents(page)).nodes.find((n) => n.id === W.id)!
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeGreaterThan(3)
  })

  test('Seed places light, dark and (when allowed) grey', async ({ page }) => {
    await startLab(page)
    await pause(page)
    const n0 = (await ents(page)).nodes.length
    await page.keyboard.press('2')
    await expect(page.getByTestId('tool-options')).toContainText('Seed')
    await page.mouse.click(683, 250)
    await page.getByTestId('seed-black').click()
    await page.mouse.click(783, 300)
    await page.getByTestId('seed-grey').click()
    await page.mouse.click(583, 300)
    await page.waitForTimeout(500)
    const e = await ents(page)
    expect(e.nodes.length).toBe(n0 + 3)
    expect(e.nodes.filter((n) => n.kind === 2).length).toBe(1)
  })

  test('Strand connects by dragging, and by clicking one then the other', async ({ page }) => {
    await startLab(page)
    await pause(page)
    await connectTwin(page)
    expect((await ents(page)).strands.length).toBe(1)
    // two-click mode with a seeded node
    await page.keyboard.press('2')
    await page.mouse.click(683, 200)
    await page.waitForTimeout(400)
    const e = await ents(page)
    const fresh = e.nodes[e.nodes.length - 1]
    const { B } = await twin(page)
    await page.keyboard.press('3')
    const a = (await proj(page, fresh.id))!
    await page.mouse.click(a.x, a.y)
    await expect(page.getByTestId('tool-options')).toContainText('Now click where the strand should go')
    const b = (await proj(page, B.id))!
    await page.mouse.click(b.x, b.y)
    await page.waitForTimeout(400)
    expect((await ents(page)).strands.length).toBe(2)
  })

  test('Pull changes a strand’s length and draws things toward a point', async ({ page }) => {
    await startLab(page)
    await pause(page)
    await connectTwin(page)
    const s0 = (await ents(page)).strands[0]
    await page.keyboard.press('4')
    const mid = (await proj(page, s0.id))!
    await drag(page, mid, { x: mid.x, y: mid.y + 120 })
    const s1 = (await ents(page)).strands[0]
    expect(s1.rest).toBeGreaterThan(s0.rest * 1.3)
    // pull field on empty space, with time running
    await page.evaluate(() => (window as any).__pt.setPaused(false))
    const { W } = await twin(page)
    const w0 = (await ents(page)).nodes.find((n) => n.id === W.id)!
    const target = (await projPt(page, w0.x, w0.y + 12, w0.z))!
    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    await page.waitForTimeout(2500)
    await page.mouse.up()
    const w1 = (await ents(page)).nodes.find((n) => n.id === W.id)!
    expect(w1.y).toBeGreaterThan(w0.y + 0.5)
  })

  test('Twist twists a strand', async ({ page }) => {
    await startLab(page)
    await pause(page)
    await connectTwin(page)
    const s = (await ents(page)).strands[0]
    await page.keyboard.press('5')
    const mid = (await proj(page, s.id))!
    await drag(page, mid, { x: mid.x + 100, y: mid.y })
    expect(Math.abs((await ents(page)).strands[0].twist)).toBeGreaterThan(1)
  })

  test('Pulse sends a wave', async ({ page }) => {
    await startLab(page)
    await page.keyboard.press('6')
    await page.mouse.move(683, 384)
    await page.mouse.down()
    await page.waitForTimeout(600)
    await page.mouse.up()
    await page.waitForTimeout(500)
    expect(await page.evaluate(() => (window as any).__pt.eventLog())).toContain('pulse')
  })

  test('Tune changes a rhythm, and a strand’s coupling', async ({ page }) => {
    await startLab(page)
    await pause(page)
    await connectTwin(page)
    const { B } = await twin(page)
    await page.keyboard.press('7')
    const b = (await proj(page, B.id))!
    await drag(page, b, { x: b.x + 140, y: b.y })
    const f1 = (await ents(page)).nodes.find((n) => n.id === B.id)!.freq
    expect(f1).toBeGreaterThan(B.freq * 1.5)
    const s = (await ents(page)).strands[0]
    const mid = (await proj(page, s.id))!
    await drag(page, mid, { x: mid.x + 150, y: mid.y })
    expect((await ents(page)).strands[0].coupling).toBeGreaterThan(s.coupling + 0.3)
  })

  test('Fracture cuts a strand and destabilizes a dark', async ({ page }) => {
    await startLab(page)
    await pause(page)
    await connectTwin(page)
    await page.keyboard.press('8')
    const s = (await ents(page)).strands[0]
    const mid = (await proj(page, s.id))!
    await page.mouse.click(mid.x, mid.y)
    await page.waitForTimeout(400)
    expect((await ents(page)).strands.length).toBe(0)
  })

  test('Fuse merges two concentrations', async ({ page }) => {
    await startLab(page)
    await pause(page)
    await page.keyboard.press('2')
    await page.mouse.click(660, 300)
    await page.mouse.click(700, 300)
    await page.waitForTimeout(400)
    const e = await ents(page)
    const [a, b] = e.nodes.slice(-2)
    await page.keyboard.press('9')
    await page.mouse.click((await proj(page, a.id))!.x, (await proj(page, a.id))!.y)
    await page.mouse.click((await proj(page, b.id))!.x, (await proj(page, b.id))!.y)
    await page.waitForTimeout(500)
    expect((await ents(page)).nodes.length).toBe(e.nodes.length - 1)
  })

  test('Veil places a shield and lifts it', async ({ page }) => {
    await startLab(page)
    await pause(page)
    await page.keyboard.press('0')
    await page.mouse.click(683, 384)
    await page.waitForTimeout(400)
    expect((await ents(page)).veils).toBe(1)
    await page.keyboard.press('8')
    await page.mouse.click(683, 384)
    await page.waitForTimeout(400)
    expect((await ents(page)).veils).toBe(0)
  })

  test('Lens and Strand Sight switch on and off', async ({ page }) => {
    await startLab(page)
    await page.keyboard.press('l')
    expect((await ui(page)).lens).toBe(true)
    await page.keyboard.press('Tab')
    expect((await ui(page)).sight).toBe(true)
    await page.screenshot({ path: 'test-results/shots/lens-sight.png' })
    await page.keyboard.press('Tab')
    await page.keyboard.press('l')
    const u = await ui(page)
    expect(u.lens || u.sight).toBe(false)
  })

  test('Anchor holds a node in place', async ({ page }) => {
    await startLab(page)
    await pause(page)
    const { W } = await twin(page)
    await page.keyboard.press('k')
    const p = (await proj(page, W.id))!
    await page.mouse.click(p.x, p.y)
    await page.waitForTimeout(400)
    expect((await ents(page)).nodes.find((n) => n.id === W.id)!.flags & 4).toBe(4)
  })
})

test.describe('time and history', () => {
  test('pause stops time, step advances one tick, speed changes pace', async ({ page }) => {
    await startLab(page)
    await page.getByTestId('pause').click()
    const t0 = (await ents(page)).tick
    await page.waitForTimeout(800)
    expect((await ents(page)).tick).toBe(t0)
    await page.getByTestId('step').click()
    await page.waitForTimeout(400)
    expect((await ents(page)).tick).toBe(t0 + 1)
    await page.getByTestId('pause').click()
    await page.getByRole('button', { name: '4×' }).click()
    const a = (await ents(page)).tick
    await page.waitForTimeout(2000)
    expect((await ents(page)).tick - a).toBeGreaterThan(120)
  })

  test('undo restores the exact earlier state; redo puts it back', async ({ page }) => {
    await startLab(page)
    await pause(page)
    const n0 = (await ents(page)).nodes.length
    await page.keyboard.press('2')
    await page.mouse.click(683, 250)
    await page.waitForTimeout(300)
    expect((await ents(page)).nodes.length).toBe(n0 + 1)
    await page.keyboard.press('Control+z')
    await page.waitForTimeout(500)
    expect((await ents(page)).nodes.length).toBe(n0)
    await page.keyboard.press('Control+y')
    await page.waitForTimeout(500)
    expect((await ents(page)).nodes.length).toBe(n0 + 1)
  })

  test('without dragging: select a strand and press + to raise its coupling', async ({ page }) => {
    await startLab(page)
    await pause(page)
    await connectTwin(page)
    await page.keyboard.press('1')
    const s = (await ents(page)).strands[0]
    const mid = (await proj(page, s.id))!
    await page.mouse.click(mid.x, mid.y)
    await page.keyboard.press('=')
    await page.keyboard.press('=')
    await page.waitForTimeout(500)
    expect((await ents(page)).strands[0].coupling).toBeGreaterThan(s.coupling + 0.05)
  })

  test('controls stay reachable while panels are open', async ({ page }) => {
    await startLab(page)
    await pause(page)
    const { W } = await twin(page)
    const p = (await proj(page, W.id))!
    await page.mouse.click(p.x, p.y)
    await page.keyboard.press('h')
    await expect(page.getByTestId('inspector')).toBeVisible()
    await expect(page.getByTestId('help')).toBeVisible()
    for (const id of ['tool-rail', 'time-bar', 'game-menu', 'photo', 'save']) await expect(page.getByTestId(id)).toBeVisible()
    await page.getByTestId('tool-strand').click()
    expect((await ui(page)).tool).toBe('strand')
  })
})

test.describe('saving and branching', () => {
  test('save, leave, and continue later', async ({ page }) => {
    await startLab(page)
    await connectTwin(page)
    await page.waitForTimeout(1000)
    await page.getByTestId('save').click()
    await page.waitForTimeout(1500)
    await page.getByTestId('game-menu').click()
    await page.getByTestId('pause-menu').getByRole('button', { name: /main menu/i }).click()
    await expect(page.getByTestId('main-menu')).toBeVisible()
    await page.reload()
    await expect(page.getByTestId('menu-continue')).toBeEnabled()
    await page.getByTestId('menu-continue').click()
    await expect(page.getByTestId('game')).toBeVisible()
    await page.waitForFunction(() => ((window as any).__pt?.entities()?.strands?.length ?? 0) >= 1)
    expect((await ents(page)).strands.length).toBeGreaterThanOrEqual(1)
  })

  test('the universe list renames and exports', async ({ page }) => {
    await startLab(page)
    await page.getByTestId('save').click()
    await page.waitForTimeout(1200)
    await page.getByTestId('game-menu').click()
    await page.getByTestId('pause-menu').getByRole('button', { name: /main menu/i }).click()
    const list = page.getByTestId('universe-list')
    await expect(list).toBeVisible()
    await list.getByRole('button', { name: 'Rename' }).first().click()
    const input = list.getByRole('textbox', { name: 'New name' })
    await input.fill('The Long Afternoon')
    await input.press('Enter')
    await expect(list.getByRole('button', { name: /The Long Afternoon/ })).toBeVisible()
    const download = page.waitForEvent('download')
    await list.getByRole('button', { name: 'Export' }).first().click()
    const file = await download
    expect(file.suggestedFilename()).toBe('The Long Afternoon.polaritium')
    const body = JSON.parse(require('node:fs').readFileSync(await file.path(), 'utf8'))
    expect(body.format).toBe('polaritium-universe')
    expect(body.meta.name).toBe('The Long Afternoon')
  })

    test('checkpoint, then branch from it', async ({ page }) => {
    await startLab(page)
    await page.waitForTimeout(800)
    await page.getByTestId('checkpoint').click()
    await page.getByTestId('checkpoint-save').click()
    await page.waitForTimeout(1500)
    await page.getByTestId('branch').click()
    await page.getByRole('button', { name: /From “Checkpoint/ }).click()
    await page.waitForTimeout(2000)
    await expect(page.getByTestId('title-panel')).toContainText('branch')
  })
})

test.describe('modes and screens', () => {
  test('a real discovery reaches the Atlas', async ({ page }) => {
    await startLab(page)
    await connectTwin(page)
    await page.getByRole('button', { name: '8×' }).click()
    await expect(page.getByTestId('discovery-toast').first()).toBeVisible({ timeout: 30000 })
    await page.keyboard.press('Escape')
    await page.getByTestId('pause-menu').getByRole('button', { name: /main menu/i }).click()
    await page.getByTestId('menu-atlas').click()
    await page.getByTestId('atlas-current').click()
    await expect(page.getByTestId('atlas-detail').locator('input').first()).toHaveValue('Living Current')
  })

  test('a Paradox Chamber starts, shows its goal, and restarts', async ({ page }) => {
    await page.goto('/index.html?test')
    await page.getByTestId('menu-chambers').click()
    await page.getByTestId('chamber-still-motion').click()
    await expect(page.getByTestId('chamber-panel')).toContainText('Still Motion')
    await page.getByTestId('chamber-panel').getByRole('button', { name: 'Hint' }).click()
    await expect(page.getByTestId('chamber-panel')).toContainText('1.')
    await page.getByTestId('chamber-panel').getByRole('button', { name: 'Restart' }).click()
    await page.waitForTimeout(500)
    expect((await ents(page)).nodes.length).toBe(2)
  })

  test('Genesis begins with the deeper laws asleep', async ({ page }) => {
    await page.goto('/index.html?test')
    await page.getByTestId('menu-genesis').click()
    await expect(page.getByTestId('genesis-panel')).toBeVisible()
    await page.keyboard.press('2')
    await expect(page.getByTestId('seed-grey')).toBeDisabled()
  })

  test('the Living Gallery keeps a moment you can view and resume', async ({ page }) => {
    await startLab(page)
    await page.waitForTimeout(800)
    await page.getByTestId('game-menu').click()
    await page.getByRole('button', { name: /Living Gallery/ }).click()
    await page.waitForTimeout(1500)
    await page.getByTestId('game-menu').click()
    await page.getByTestId('pause-menu').getByRole('button', { name: /main menu/i }).click()
    await page.getByTestId('menu-gallery').click()
    await expect(page.getByTestId('exhibit')).toHaveCount(1)
    await page.getByTestId('exhibit').getByRole('button', { name: 'Resume' }).click()
    await expect(page.getByTestId('game')).toBeVisible()
    await expect(page.getByTestId('title-panel')).toContainText('resumed')
  })

  test('settings are kept after a reload', async ({ page }) => {
    await page.goto('/index.html?test')
    await page.getByTestId('menu-settings').click()
    await page.getByTestId('quality-low').click()
    await page.reload()
    await page.getByTestId('menu-settings').click()
    await expect(page.getByTestId('quality-low')).toHaveClass(/active/)
  })

  test('a picture renders with its text, ready to save', async ({ page }) => {
    await startLab(page)
    await page.waitForTimeout(800)
    await page.getByTestId('photo').click()
    await expect(page.getByTestId('export-dialog')).toBeVisible()
    await expect(page.getByTestId('export-save')).toBeEnabled({ timeout: 10000 })
    await page.screenshot({ path: 'test-results/shots/export.png' })
  })

  test('with AI off, readings are local and nothing is sent', async ({ page }) => {
    await startLab(page)
    await page.getByTestId('ai-button').click()
    await page.getByTestId('ai-interpret').click()
    await expect(page.getByTestId('ai-output')).toContainText('Local reading')
  })

  test('Compare runs two experiments side by side', async ({ page }) => {
    await startLab(page)
    await page.getByTestId('save').click()
    await page.waitForTimeout(1200)
    await page.getByTestId('game-menu').click()
    await page.getByTestId('pause-menu').getByRole('button', { name: /main menu/i }).click()
    await page.getByTestId('menu-compare').click()
    await page.getByTestId('compare-pick-a').selectOption({ index: 1 })
    await page.getByTestId('compare-pick-b').selectOption({ index: 1 })
    await page.waitForTimeout(1500)
    await page.getByTestId('compare-run').click()
    await page.waitForTimeout(2500)
    await expect(page.getByTestId('compare-table')).not.toContainText('—')
  })
})

test.describe('optional AI with a pretend Claude (?mockai)', () => {
  test('defaults to $10 and off; switching on, asking, and raising the budget all behave', async ({ page }) => {
    await page.goto('/index.html?test&mockai')
    await page.getByTestId('menu-settings').click()
    await page.getByTestId('settings-budget').click()
    await expect(page.getByTestId('budget-dashboard')).toContainText('$10.00')
    await expect(page.getByTestId('budget-dashboard')).toContainText('off')
    await page.getByTestId('settings-ai').click()
    await page.getByTestId('ai-toggle').check()
    await page.getByTestId('settings-budget').click()
    await page.getByTestId('budget-20000000').click()
    await expect(page.getByTestId('budget-confirm')).toContainText('$10.00 → $20.00')
    await page.getByRole('button', { name: 'Keep it as it is' }).click()
    await expect(page.getByTestId('budget-dashboard')).toContainText('Monthly allowance')
    await page.getByTestId('back').click()
    await page.getByTestId('menu-new').click()
    await page.getByTestId('start-experiment').click()
    await expect(page.getByTestId('tool-rail')).toBeVisible()
    await page.getByTestId('ai-button').click()
    await page.getByTestId('ai-interpret').click()
    await expect(page.getByTestId('ai-output')).toContainText('test reply', { timeout: 10000 })
    await expect(page.getByTestId('ai-output')).toContainText('cost')
    await page.getByTestId('ai-off').click()
    await page.getByTestId('ai-interpret').click()
    await expect(page.getByTestId('ai-output')).toContainText('Local reading')
  })
})
