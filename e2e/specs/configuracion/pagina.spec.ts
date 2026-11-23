import { expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

// Un negocio que todavía no tocó su horario: el de siempre, lunes a viernes.
const HORARIO_SIN_CONFIGURAR = {
  timezone: 'America/Lima',
  configured: false,
  days: Array.from({ length: 7 }, (_, weekday) => (
    weekday < 5
      ? { weekday, open: true, start: '08:00', end: '18:00' }
      : { weekday, open: false, start: '09:00', end: '13:00' }
  )),
}

const VER_SOLO_ASIGNADOS = {
  key: 'sellers_see_only_assigned_leads',
  label: 'Cada vendedor ve solo los leads asignados a él (los administradores ven todos)',
  group: 'leads', group_label: 'Leads (CRM)', secret: false, boolean: true, configured: false, value: '',
}

test('Configuración es una página con una sección por URL, no un diálogo', async ({ page, api }, info) => {
  api
    .on('get', '/api/settings', [VER_SOLO_ASIGNADOS])
    .on('get', '/api/settings/business-hours', HORARIO_SIN_CONFIGURAR)
    .on('get', '/api/users', [])

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
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/configuracion-${info.project.name}.png` })

  await page.getByRole('navigation', { name: 'Secciones de configuración' }).getByRole('link', { name: 'Usuarios' }).click()
  await expect(page).toHaveURL(/\/configuracion\/usuarios$/)
  await expect(page.getByRole('button', { name: 'Guardar', exact: true })).toHaveCount(0)
  await expectNoPageOverflow(page)
})

test('el negocio define su horario de atención y puede abrir el sábado', async ({ page, api }, info) => {
  // Era lunes a viernes de 8 a 18 para todos: las automatizaciones «solo en
  // horario laboral» descartaban los sábados de un negocio que sí atiende.
  const guardado = {
    ...HORARIO_SIN_CONFIGURAR,
    configured: true,
    days: HORARIO_SIN_CONFIGURAR.days.map(day => (day.weekday === 5 ? { ...day, open: true } : day)),
  }
  api
    .on('get', '/api/settings', [VER_SOLO_ASIGNADOS])
    .on('get', '/api/settings/business-hours', HORARIO_SIN_CONFIGURAR)
    .on('put', '/api/settings/business-hours', guardado)

  await page.goto('/configuracion')

  const card = page.getByRole('region', { name: 'Horario de atención' })
  await card.scrollIntoViewIfNeeded()
  await expect(card).toContainText('Todavía no lo configuraste')
  const save = card.getByRole('button', { name: 'Guardar horario' })
  // Sin cambios no hay nada que guardar.
  await expect(save).toBeDisabled()

  await card.getByRole('checkbox', { name: 'Sábado' }).click()
  await expect(card.getByLabel('Sábado: desde')).toHaveValue('09:00')

  // Cerrar antes de abrir se avisa en la fila, sin llegar al backend.
  await card.getByLabel('Sábado: hasta').fill('08:00')
  await expect(card.getByRole('alert')).toContainText('El sábado la hora de cierre debe ser posterior')
  await expect(save).toBeDisabled()

  await card.getByLabel('Sábado: hasta').fill('13:00')
  await card.getByLabel('Sábado: hasta').blur()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/configuracion-horario-${info.project.name}.png` })
  await save.click()

  await expect(card.getByRole('status')).toContainText('Horario guardado')
  const [call] = api.calls('put', '/api/settings/business-hours')
  expect((call.body as { days: { weekday: number; open: boolean }[] }).days.filter(day => day.open).map(day => day.weekday))
    .toEqual([0, 1, 2, 3, 4, 5])
})
