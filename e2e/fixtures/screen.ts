import { expect, type Locator, type Page } from '@playwright/test'

/**
 * El elemento entra entero en la pantalla. `toBeInViewport` a secas se
 * conforma con que asome un píxel, que es justo el caso de un menú cortado.
 */
export async function expectFullyOnScreen(locator: Locator) {
  await expect(locator).toBeVisible()
  await expect(locator).toBeInViewport({ ratio: 1 })
}

/** Nada empuja la página más allá del ancho o el alto de la pantalla. */
export async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.getElementById('root')!
    const box = root.getBoundingClientRect()
    return { right: box.right - window.innerWidth, bottom: box.bottom - window.innerHeight }
  })
  expect(overflow.right, 'la app es más ancha que la pantalla').toBeLessThanOrEqual(0)
  expect(overflow.bottom, 'la app es más alta que la pantalla').toBeLessThanOrEqual(0)
}
