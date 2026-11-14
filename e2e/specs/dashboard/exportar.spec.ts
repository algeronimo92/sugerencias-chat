import { emptyDashboard } from '../../fixtures/dashboard'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

test('el menú "Exportar" entra entero en la pantalla y baja el Excel del período elegido', async ({ page, api }) => {
  api.on('get', '/api/dashboard', ({ url }) => emptyDashboard(Number(url.searchParams.get('days') ?? 30)))
  const requested: string[] = []
  // El archivo es binario y el backend simulado responde JSON: esta ruta se
  // atiende aparte, después de instalarlo, y gana por ser la última.
  await page.route(/\/api\/dashboard\/export\//, async (route) => {
    requested.push(new URL(route.request().url()).pathname + new URL(route.request().url()).search)
    await route.fulfill({
      status: 200,
      contentType: XLSX,
      headers: { 'Content-Disposition': 'attachment; filename="separaciones-90-dias-2026-11-14.xlsx"' },
      body: Buffer.from('PK'),
    })
  })

  await page.goto('/dashboard')
  await page.getByRole('combobox', { name: 'Período' }).click()
  await page.getByRole('option', { name: 'Últimos 90 días' }).click()
  await page.getByRole('button', { name: 'Exportar' }).click()

  // En el celular la cabecera se parte en filas: cada opción tiene que verse
  // entera, sin cortarse por un borde.
  const menu = page.getByRole('menu', { name: 'Exportar a Excel' })
  await expectFullyOnScreen(menu)
  for (const item of await menu.getByRole('menuitem').all()) {
    await expectFullyOnScreen(item)
  }
  await expectNoPageOverflow(page)

  const download = page.waitForEvent('download')
  await menu.getByRole('menuitem', { name: /Separaciones y adelantos/ }).click()
  expect((await download).suggestedFilename()).toBe('separaciones-90-dias-2026-11-14.xlsx')
  expect(requested).toEqual(['/api/dashboard/export/separaciones?days=90'])
  await expect(menu).toBeHidden()
})
