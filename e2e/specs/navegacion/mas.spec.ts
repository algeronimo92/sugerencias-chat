import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

test('en el celular la cabecera no amontona íconos y "Más" reúne las acciones de la cuenta', async ({ page }, info) => {
  test.skip(info.project.name !== 'celular', 'Solo el celular cambia la cabecera y la barra inferior')

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Conversaciones' })).toBeVisible()

  // Antes eran seis íconos de 28 px y el nombre del negocio quedaba cortado.
  for (const accion of ['Configuración', 'Reportar un problema', 'Cerrar sesión']) {
    await expect(page.getByRole('button', { name: accion, exact: true })).toHaveCount(0)
  }
  await expectNoPageOverflow(page)

  await page.getByRole('button', { name: 'Más', exact: true }).click()
  const hoja = page.getByRole('dialog', { name: 'Más vistas' })
  for (const accion of ['Automatizaciones', 'Configuración', 'Reportar un problema', 'Modo oscuro', 'Cerrar sesión']) {
    await expectFullyOnScreen(hoja.getByRole('button', { name: accion }))
  }
})
