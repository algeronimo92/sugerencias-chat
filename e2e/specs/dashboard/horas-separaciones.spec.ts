import { emptyDashboard } from '../../fixtures/dashboard'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

// Doce franjas por siete días en el ancho de un celular: lo que se comprueba
// acá es que el mapa entre entero. Los números de cada celda viven en Vitest.
test('el mapa de a qué hora se separan las citas entra en la pantalla y dice el dato de la celda', async ({ page, api }) => {
  api.on('get', '/api/dashboard', () => {
    const dashboard = emptyDashboard(30)
    const cell = { conversations: 0, settled: 0, engaged: 0, flows_manual: 0, flows_automatic: 0, messages: 0, phone_messages: 0 }
    dashboard.hours.cells = [
      { ...cell, weekday: 0, slot: 5, separations: 4 },
      { ...cell, weekday: 2, slot: 9, separations: 12 },
      { ...cell, weekday: 5, slot: 6, separations: 10 },
    ]
    return dashboard
  })

  await page.goto('/dashboard')
  await page.getByRole('tab', { name: 'Ventas' }).click()
  const panel = page.getByRole('region', { name: 'A qué hora se separan las citas' })
  await panel.scrollIntoViewIfNeeded()
  await expectFullyOnScreen(panel.getByRole('table'))
  await expectNoPageOverflow(page)

  // Doce separaciones en los cuatro miércoles del período: tres por miércoles.
  await panel.getByRole('button', { name: 'Mié 18–20 h: 3 separaciones registradas en promedio' }).click()
  await expect(panel.getByText('Mié 18–20 h: 3 separaciones registradas en promedio')).toBeVisible()
})
