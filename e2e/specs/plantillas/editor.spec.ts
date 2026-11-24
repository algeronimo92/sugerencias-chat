import type { ApiResponse } from '../../../frontend/src/shared/http/contract'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

type Template = ApiResponse<'/api/templates', 'get'>[number]

function template(overrides: Partial<Template>): Template {
  return {
    id: 1, name: 'Saludo', content: 'Hola {{nombre}}', shortcut: null, category: 'ventas', stage: null, task_type: null, service: null,
    is_active: true, visibility: 'global', template_type: 'internal', official_name: null, official_language: null,
    official_category: null, official_status: null, official_rejected_reason: null, official_parameter_values: [], meta_template_id: null,
    official_last_edit_at: null, official_next_edit_at: null,
    official_header_type: 'none', official_header_text: null, official_header_media_asset_id: null, official_header_media_url: null,
    official_header_media_content_type: null, official_header_media_filename: null, official_footer: null, official_buttons: [],
    interactive_type: 'none', interactive_config: {}, imported_from_meta: false, is_favorite: false, last_used_at: null, use_count: 0,
    created_by_user_id: 1, created_by_name: 'Admin', created_at: '2026-11-12T10:00:00Z', attachments: [],
    ...overrides,
  }
}

const TEMPLATES: Template[] = [
  template({ id: 1, name: 'slogan hifu12d', shortcut: 'hifu-12d', content: 'El *HIFU 12D* es un tratamiento de última generación que trabaja con ultrasonido focalizado.', use_count: 2938 }),
  template({
    id: 2, name: 'aviso_cita_cliente', category: 'Seguimiento', template_type: 'official', official_name: 'aviso_cita_cliente',
    official_language: 'es', official_category: 'UTILITY', official_status: 'APPROVED', meta_template_id: '900', imported_from_meta: true,
    content: '¡Hola *{{1}}*! Tu sesión de *{{2}}* quedó registrada para el *{{3}} a las {{4}}*. Te esperamos.',
    official_parameter_values: ['{{nombre}}', '{{cita.tratamiento}}', '{{cita.fecha_larga}}', '{{cita.hora_12h}}'], use_count: 1,
  }),
  template({
    id: 3, name: 'Recordatorio de pago', category: 'Seguimiento', template_type: 'official', official_name: 'recordatorio_de_pago',
    official_language: 'es', official_category: 'UTILITY', official_status: 'REJECTED', official_rejected_reason: 'TAG_CONTENT_MISMATCH',
    meta_template_id: '901', content: 'Aprovecha 2x1 en limpieza facial solo por hoy.',
  }),
  template({ id: 4, name: 'Promo de diciembre', template_type: 'official', official_name: 'promo_de_diciembre', official_language: 'es', official_category: 'MARKETING', official_status: 'PENDING', meta_template_id: '902', content: 'Este mes tenemos una promoción para ti.' }),
]

test.beforeEach(({ api }) => {
  api
    .on('get', '/api/templates', TEMPLATES)
    .on('get', '/api/template-categories', [
      { id: 1, name: 'Seguimiento', is_active: true, created_by_user_id: 1, created_by_name: 'Admin', created_at: null },
      { id: 2, name: 'ventas', is_active: true, created_by_user_id: 1, created_by_name: 'Admin', created_at: null },
    ])
    .on('get', '/api/media-library', [])
})

test('la lista muestra el estado de Meta y entra entera en la pantalla', async ({ page }, info) => {
  await page.goto('/templates')

  await expect(page.getByRole('heading', { name: 'Plantillas', level: 1 })).toBeVisible()
  const rows = page.getByRole('listitem')
  await expect(rows).toHaveCount(4)
  await expect(rows.nth(0)).toContainText('slogan hifu12d')
  await expect(rows.filter({ hasText: 'Recordatorio de pago' })).toContainText('Rechazada')
  await expect(rows.filter({ hasText: 'Promo de diciembre' })).toContainText('En revisión')
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/plantillas-lista-${info.project.name}.png` })

  await page.getByRole('searchbox', { name: 'Buscar plantillas' }).fill('hifu')
  await expect(rows).toHaveCount(1)
})

test('el editor oficial muestra la vista previa y deja guardar siempre a la vista', async ({ page, api }, info) => {
  const mobile = info.project.name === 'celular'
  api.on('post', '/api/templates', ({ body }) => template({ ...(body as Partial<Template>), id: 9, official_status: 'PENDING' }))
  await page.goto('/templates')
  await page.getByRole('link', { name: 'Nueva plantilla' }).click()

  await expect(page).toHaveURL(/\/templates\/nueva$/)
  await expect(page.getByRole('heading', { name: 'Nueva plantilla', level: 1 })).toBeVisible()
  await page.getByRole('radio', { name: /Escribir primero o después de 24 horas/ }).check()
  const name = page.getByRole('textbox', { name: /^Nombre \(obligatorio\)/ })
  await name.fill('Aviso de cita')
  await expect(page.getByText('aviso_de_cita')).toBeVisible()

  const message = page.getByRole('textbox', { name: /^Texto del mensaje/ })
  await message.fill('¡Hola ')
  await page.getByRole('button', { name: 'Insertar dato' }).click()
  await page.getByRole('menuitem', { name: 'Nombre' }).click()
  await message.pressSequentially('! Tu cita quedó *registrada*. Te esperamos.')
  await expect(message).toHaveValue('¡Hola {{1}}! Tu cita quedó *registrada*. Te esperamos.')
  // El contador del mensaje y su tope están a la vista mientras se escribe.
  await expect(page.getByText('54 / 1024')).toBeVisible()

  const submit = page.getByRole('button', { name: 'Enviar a revisión de Meta' }).filter({ visible: true })
  await expectFullyOnScreen(submit)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/plantillas-editor-${info.project.name}.png` })

  if (mobile) await page.getByRole('tab', { name: 'Vista previa' }).click()
  const preview = page.getByRole('region', { name: 'Así lo verá el cliente' })
  await expect(preview).toContainText('¡Hola Ana! Tu cita quedó registrada. Te esperamos.')
  await expect(page.getByRole('region', { name: 'Antes de enviarla' })).toContainText('Cumple con lo que Meta suele rechazar')
  await expectFullyOnScreen(submit)
  await page.screenshot({ path: `test-results/plantillas-vista-previa-${info.project.name}.png` })

  await submit.click()
  await expect(page).toHaveURL(/\/templates$/)
  expect(api.calls('post', '/api/templates')[0].body).toMatchObject({
    template_type: 'official', official_name: 'aviso_de_cita', content: '¡Hola {{1}}! Tu cita quedó *registrada*. Te esperamos.', official_parameter_values: ['{{nombre}}'],
  })
})

test('al guardar con errores, el primero queda a la vista junto a su campo', async ({ page }, info) => {
  await page.goto('/templates/nueva')
  // Se baja hasta el final, como quien termina de llenar y va a guardar.
  await page.getByRole('textbox', { name: /^Atajo/ }).fill('hifu 12d')
  await page.getByRole('button', { name: 'Guardar plantilla' }).filter({ visible: true }).click()

  const name = page.getByRole('textbox', { name: /^Nombre \(obligatorio\)/ })
  await expect(name).toBeFocused()
  await expectFullyOnScreen(name)
  await expectFullyOnScreen(page.getByText('El nombre es obligatorio.'))
  await expect(page.getByRole('button', { name: 'Falta corregir 3 puntos' })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/plantillas-errores-${info.project.name}.png` })
})

test('una aprobada avisa del cupo de ediciones de Meta y no deja cambiar el tipo de mensaje', async ({ page }, info) => {
  await page.goto('/templates/2')

  await expect(page.getByText('Esta plantilla está aprobada')).toBeVisible()
  await expect(page.getByText(/una vez cada 24 horas y diez veces cada 30 días/)).toBeVisible()
  const promotion = page.getByRole('radio', { name: /^Promoción/ })
  await promotion.scrollIntoViewIfNeeded()
  await expect(promotion).toBeDisabled()
  await expect(page.getByRole('textbox', { name: /^Texto del mensaje/ })).toBeEnabled()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/plantillas-aprobada-${info.project.name}.png` })
})

test('mientras Meta la revisa, el mensaje queda bloqueado y lo demás se puede guardar', async ({ page, api }, info) => {
  api.on('patch', '/api/templates/{template_id}', ({ body }) => ({ ...TEMPLATES[3], ...(body as Partial<Template>) }))
  await page.goto('/templates/4')

  await expect(page.getByText('Meta la está revisando')).toBeVisible()
  const message = page.getByRole('textbox', { name: /^Texto del mensaje/ })
  await message.scrollIntoViewIfNeeded()
  await expect(message).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Insertar dato' })).toBeDisabled()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/plantillas-en-revision-${info.project.name}.png` })

  await page.getByRole('textbox', { name: /^Nombre \(obligatorio\)/ }).fill('Promo de fin de año')
  await page.getByRole('button', { name: 'Guardar cambios' }).filter({ visible: true }).click()
  await expect(page).toHaveURL(/\/templates$/)
  expect(api.calls('patch', '/api/templates/{template_id}')[0].body).toMatchObject({ name: 'Promo de fin de año', content: 'Este mes tenemos una promoción para ti.' })
})

test('con el cupo de 24 horas gastado, la lista y el editor dicen desde cuándo se puede volver a editar', async ({ page, api }, info) => {
  // El caso real del 23-11-2026: editada 13:12 y vuelta a intentar 13:17.
  // Con el reloj fijo en ese momento: con la hora real, los cinco minutos
  // después de medianoche la edición caía «ayer» y el próximo cambio «hoy», y
  // la prueba fallaba sin que nada estuviera roto (tumbó un despliegue el
  // 24-11-2026 a las 00:00 de Lima).
  const now = new Date('2026-11-23T18:17:00Z')
  await page.clock.setFixedTime(now)
  const lastEdit = new Date(now.getTime() - 5 * 60_000)
  const edited = template({
    ...TEMPLATES[1], id: 21, name: 'Desde Instagram', official_name: 'desde_instagram', official_category: 'MARKETING', imported_from_meta: false,
    content: 'Hola {{1}}, gracias por escribirnos desde Instagram. ¿En qué tratamiento te ayudamos?', official_parameter_values: ['{{nombre}}'],
    official_last_edit_at: lastEdit.toISOString(), official_next_edit_at: new Date(lastEdit.getTime() + 24 * 3_600_000).toISOString(),
  })
  api.on('get', '/api/templates', [edited, ...TEMPLATES])

  await page.goto('/templates')
  const row = page.getByRole('listitem').filter({ hasText: 'Desde Instagram' })
  await expect(row).toContainText(/Editable desde mañana a las/)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/plantillas-cupo-lista-${info.project.name}.png` })

  await row.getByRole('link', { name: 'Editar' }).click()
  await expect(page.getByText(/^Ya enviaste un cambio a Meta hoy a las/)).toBeVisible()
  await expect(page.getByText(/Meta acepta el próximo cambio en el mensaje desde mañana a las/)).toBeVisible()
  await expect(page.getByRole('textbox', { name: /^Nombre \(obligatorio\)/ })).toBeEnabled()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/plantillas-cupo-editor-${info.project.name}.png` })
  await expect(page.getByRole('textbox', { name: /^Texto del mensaje/ })).toBeDisabled()
})

test('si Meta rechaza el guardado, el editor dice que no se envió y la lista marca los cambios sin enviar', async ({ page, api }, info) => {
  api.fail('patch', '/api/templates/{template_id}', 502, 'Meta no aceptó el cambio: la plantilla ya fue editada hoy.')
  await page.goto('/templates/2')
  const message = page.getByRole('textbox', { name: /^Texto del mensaje/ })
  await message.fill('¡Hola {{1}}! Tu sesión de {{2}} quedó registrada para el {{3}} a las {{4}}. Te esperamos en la clínica.')
  await page.getByRole('button', { name: 'Enviar a revisión de Meta' }).filter({ visible: true }).click()

  const notice = page.getByText(/No se guardó ni se envió a Meta/)
  await expectFullyOnScreen(notice)
  await expect(page.getByText('Meta no aceptó el cambio: la plantilla ya fue editada hoy.')).toBeVisible()
  await page.screenshot({ path: `test-results/plantillas-no-enviado-${info.project.name}.png` })

  await page.getByRole('link', { name: 'Plantillas' }).first().click()
  await expect(page.getByRole('listitem').filter({ hasText: 'aviso_cita_cliente' })).toContainText('Cambios sin enviar')
  await page.screenshot({ path: `test-results/plantillas-sin-enviar-lista-${info.project.name}.png` })
})
