import { FLOWS, execution } from '../../fixtures/crm'
import { expectFullyOnScreen } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

// Un negocio como DermicaPro: solo flujos visuales, ninguna regla simple.
test.beforeEach(({ api }) => {
  api
    .on('get', '/api/automations', FLOWS)
    .on('get', '/api/users', [])
    .on('get', '/api/tags', [])
    .on('get', '/api/media-library', [])
})

test('con flujos y sin reglas se entra en los flujos, no en una pestaña vacía', async ({ page }, info) => {
  await page.goto('/automations')

  // Antes abría en «Reglas (0)» y decía «Todavía no hay automatizaciones»
  // debajo del contador «Automatizaciones 5».
  await expect(page.getByRole('heading', { name: FLOWS[0].name })).toBeVisible()
  await expect(page.getByText('Todavía no hay automatizaciones')).toHaveCount(0)
  await page.screenshot({ path: `test-results/automatizaciones-entrada-${info.project.name}.png` })

  await page.getByRole('button', { name: /^Reglas/ }).click()
  await expect(page.getByText('Tus automatizaciones están en «Flujos visuales»')).toBeVisible()
})

test('pausar un flujo pide confirmación y dice qué pasa con lo que está en curso', async ({ page, api }, info) => {
  const flow = FLOWS[0]
  api.on('patch', '/api/automations/{rule_id}', { ...flow, is_active: false })

  await page.goto('/automations')
  await page.getByRole('button', { name: `Pausar ${flow.name}` }).click()

  const dialog = page.getByRole('alertdialog', { name: `Pausar “${flow.name}”` })
  await expectFullyOnScreen(dialog)
  await expect(dialog).toContainText('no recibirán los pasos que faltan')
  await page.screenshot({ path: `test-results/automatizaciones-pausar-${info.project.name}.png` })

  // Arrepentirse no toca nada: era un clic directo junto a «Eliminar».
  await dialog.getByRole('button', { name: 'No pausar' }).click()
  expect(api.calls('patch', '/api/automations/{rule_id}')).toEqual([])

  await page.getByRole('button', { name: `Pausar ${flow.name}` }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Pausar', exact: true }).click()
  expect(api.calls('patch', '/api/automations/{rule_id}')).toEqual([
    { method: 'patch', path: `/api/automations/${flow.id}`, body: { is_active: false } },
  ])
})

test('el historial avisa cuando hay más ejecuciones de las que muestra', async ({ page, api }, info) => {
  // El listado trae 200 como máximo y los días normales superan las 300:
  // se leía «200 resultados» como si fuera todo.
  const full = Array.from({ length: 200 }, (_, index) => execution(FLOWS[index % FLOWS.length], { id: 1000 + index, status: 'completed' }))
  api.on('get', '/api/automations/executions', full)

  await page.goto('/automations?tab=history')

  const notice = page.getByRole('status').filter({ hasText: 'Hay más ejecuciones de las que se muestran' })
  // La cabecera de la página lo deja bajo el pliegue en el celular.
  await notice.scrollIntoViewIfNeeded()
  await expectFullyOnScreen(notice)
  await expect(page.getByText('Las 200 más recientes', { exact: true })).toBeVisible()
  await page.screenshot({ path: `test-results/automatizaciones-historial-${info.project.name}.png` })
})

test('el historial distingue lo que alguien canceló de lo que no aplicó', async ({ page, api }, info) => {
  // Las dos se guardaban como «skipped» y se leían «Omitida»: en DermicaPro
  // 655 de 718 eran cancelaciones, no flujos que no aplicaban.
  api.on('get', '/api/automations/executions', [
    execution(FLOWS[0], { id: 2001, status: 'cancelled', error: 'Cancelada manualmente', finished_at: new Date().toISOString() }),
    execution(FLOWS[1], { id: 2002, status: 'skipped', error: 'El cliente respondió antes del vencimiento', finished_at: new Date().toISOString() }),
  ])

  await page.goto('/automations?tab=history')

  const cancelled = page.locator('details').filter({ hasText: FLOWS[0].name })
  const skipped = page.locator('details').filter({ hasText: FLOWS[1].name })
  await expect(cancelled.getByText('Cancelada', { exact: true })).toBeVisible()
  await expect(skipped.getByText('No aplicó', { exact: true })).toBeVisible()
  await cancelled.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `test-results/automatizaciones-estados-${info.project.name}.png` })

  // Reintentar es para lo que falló o no aplicó; lo cancelado se relanza a propósito.
  await cancelled.locator('summary').click()
  await skipped.locator('summary').click()
  await expect(skipped.getByRole('button', { name: 'Reintentar' })).toBeVisible()
  await expect(cancelled.getByRole('button', { name: 'Reintentar' })).toHaveCount(0)
})
