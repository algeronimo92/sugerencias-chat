import { expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

const VER_SOLO_ASIGNADOS = {
  key: 'sellers_see_only_assigned_leads',
  label: 'Cada vendedor ve solo los leads asignados a él (los administradores ven todos)',
  group: 'leads', group_label: 'Leads (CRM)', secret: false, boolean: true, configured: false, value: '',
}

test('Configuración es una página con una sección por URL, no un diálogo', async ({ page, api }, info) => {
  api.on('get', '/api/settings', [VER_SOLO_ASIGNADOS]).on('get', '/api/users', [])

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Conversaciones', level: 1 })).toBeVisible()
  if (info.project.name === 'celular') {
    await page.getByRole('button', { name: 'Más', exact: true }).click()
    await page.getByRole('dialog', { name: 'Más vistas' }).getByRole('button', { name: 'Configuración' }).click()
  } else {
    await page.getByRole('button', { name: 'Configuración', exact: true }).click()
  }

  await expect(page).toHaveURL(/\/configuracion$/)
  await expect(page.getByRole('heading', { name: 'Configuración', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('checkbox', { name: VER_SOLO_ASIGNADOS.label })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/configuracion-${info.project.name}.png` })

  await page.getByRole('navigation', { name: 'Secciones de configuración' }).getByRole('link', { name: 'Usuarios' }).click()
  await expect(page).toHaveURL(/\/configuracion\/usuarios$/)
  await expect(page.getByRole('button', { name: 'Guardar' })).toHaveCount(0)
  await expectNoPageOverflow(page)
})
