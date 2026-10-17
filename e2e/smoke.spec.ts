import { expect, test } from '@playwright/test'

test('menu, new experiment and the first universe render and run', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`)
  })
  await page.goto('/index.html')
  await expect(page.getByTestId('main-menu')).toBeVisible()
  await page.waitForTimeout(2500)
  await page.screenshot({ path: 'test-results/shots/01-menu.png' })
  await page.getByTestId('menu-new').click()
  await expect(page.getByTestId('new-experiment')).toBeVisible()
  await page.screenshot({ path: 'test-results/shots/02-new.png' })
  await page.getByTestId('start-experiment').click()
  await expect(page.getByTestId('game')).toBeVisible()
  await expect(page.getByTestId('tool-rail')).toBeVisible()
  await page.waitForTimeout(4000)
  await page.screenshot({ path: 'test-results/shots/03-game.png' })
  console.log(errors.join('\n'))
  expect(errors.filter((e) => !/AudioContext|autoplay/i.test(e))).toEqual([])
})
