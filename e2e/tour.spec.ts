import { expect, test, type Page } from '@playwright/test'

// A visual tour: every environment with a lively starting system, run fast for a while,
// photographed. Used to judge the look; it also fails on any page error.

async function start(page: Page, env: string, preset: string) {
  await page.goto('/index.html')
  await page.getByTestId('menu-new').click()
  await page.getByTestId(`env-${env}`).click()
  await page.getByTestId(`preset-${preset}`).click()
  await page.getByTestId('start-experiment').click()
  await expect(page.getByTestId('tool-rail')).toBeVisible()
  const skip = page.getByTestId('tutorial').getByRole('button')
  if (await skip.isVisible().catch(() => false)) await skip.click()
}

const runs: [string, string, number][] = [
  ['cradle', 'twin', 25],
  ['cathedral', 'choir', 20],
  ['garden', 'scatter', 20],
  ['well', 'orchard', 20],
  ['threshold', 'shoal', 20],
  ['cradle', 'engine', 20]
]

for (const [env, preset, seconds] of runs) {
  test(`tour ${env} ${preset}`, async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await start(page, env, preset)
    if (preset === 'twin') {
      // connect the two with the Strand tool by keyboard-free route: use the store through a strand drag
      await page.keyboard.press('3')
    }
    await page.getByRole('button', { name: '8×' }).click()
    await page.waitForTimeout(seconds * 1000)
    await page.screenshot({ path: `test-results/shots/tour-${env}-${preset}.png` })
    await page.keyboard.press('Tab')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `test-results/shots/tour-${env}-${preset}-sight.png` })
    await page.keyboard.press('Tab')
    await page.keyboard.press('l')
    await page.waitForTimeout(800)
    await page.screenshot({ path: `test-results/shots/tour-${env}-${preset}-lens.png` })
    expect(errors).toEqual([])
  })
}
