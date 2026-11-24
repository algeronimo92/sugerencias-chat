import { flow } from '../../fixtures/crm'
import { expectFullyOnScreen } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

// Un flujo que solo corre en el horario de atención, en un negocio que
// todavía no configuró el suyo (vale lunes a viernes de 8 a 18).
// Por JSON: el contrato tipa el flujo como JSON abierto, sin los literales.
const DEFINITION = JSON.parse(JSON.stringify({
  conditions: { business_hours_only: true },
  nodes: [
    { id: 'trigger-1', type: 'trigger', position: { x: 70, y: 220 }, data: { trigger_type: 'lead_created' } },
    { id: 'action-1', type: 'action', position: { x: 390, y: 220 }, data: { action: { type: 'send_message', text: 'Hola {{nombre}}' } } },
    { id: 'end-1', type: 'end', position: { x: 710, y: 220 }, data: { label: 'Fin', close_conversation: false } },
  ],
  edges: [
    { id: 'e1', source: 'trigger-1', target: 'action-1', source_handle: 'next' },
    { id: 'e2', source: 'action-1', target: 'end-1', source_handle: 'next' },
  ],
}))

const SEGUIMIENTO = {
  ...flow(30, 'Seguimiento clientes'),
  trigger_type: 'lead_created' as const,
  flow_definition: DEFINITION,
  // Publicado tal cual: un flujo real nunca trae una versión publicada vacía.
  published_flow_definition: DEFINITION,
}

const days = (openSaturday: boolean) => Array.from({ length: 7 }, (_, weekday) => (
  weekday < 5
    ? { weekday, open: true, start: '08:00', end: '18:00' }
    : { weekday, open: weekday === 5 && openSaturday, start: '09:00', end: '13:00' }
))
const usedBy = [{ id: SEGUIMIENTO.id, name: SEGUIMIENTO.name, is_active: true }]

test('la condición de horario muestra cuál es y deja cambiarlo sin salir del editor', async ({ page, api }, info) => {
  // Decía «Horario laboral» sin decir cuál: había que saber que se define en
  // Configuración, y el horario por defecto dejaba fuera los sábados en silencio.
  api
    .on('get', '/api/automations', [SEGUIMIENTO])
    .on('get', '/api/users', [])
    .on('get', '/api/tags', [])
    .on('get', '/api/media-library', [])
    .on('get', '/api/settings/business-hours', { timezone: 'America/Lima', configured: false, used_by: usedBy, days: days(false) })
    .on('put', '/api/settings/business-hours', { timezone: 'America/Lima', configured: true, used_by: usedBy, days: days(true) })

  await page.goto(`/automations?automatizacion=${SEGUIMIENTO.id}`)
  await page.getByRole('button', { name: 'Condiciones de entrada' }).click()

  await expect(page.getByText('lun a vie 08:00–18:00')).toBeVisible()
  await expect(page.getByText('Es el horario por defecto. ¿Es el de tu negocio?')).toBeVisible()
  await page.screenshot({ path: `test-results/horario-editor-aviso-${info.project.name}.png` })

  await page.getByRole('button', { name: 'Cambiar horario' }).click()
  const dialog = page.getByRole('dialog', { name: 'Horario de atención' })
  // En el celular el diálogo ocupa casi toda la pantalla y entra con una
  // animación: se espera a que el botón esté a la vista antes de medirlo.
  const save = dialog.getByRole('button', { name: 'Guardar horario' })
  await save.scrollIntoViewIfNeeded()
  await expect(async () => { await expectFullyOnScreen(save) }).toPass({ timeout: 5_000 })
  await expect(dialog).toContainText(`Lo usa 1 automatización: «${SEGUIMIENTO.name}».`)
  await dialog.getByRole('checkbox', { name: 'Sábado' }).click()
  await page.screenshot({ path: `test-results/horario-editor-dialogo-${info.project.name}.png` })
  await dialog.getByRole('button', { name: 'Guardar horario' }).click()
  await expect(dialog.getByRole('status')).toContainText('Horario guardado')
  await dialog.getByRole('button', { name: 'Cerrar' }).click()

  // El editor sigue abierto, con el horario nuevo y sin el aviso.
  await expect(page.getByText('lun a vie 08:00–18:00; sáb 09:00–13:00')).toBeVisible()
  await expect(page.getByText('Es el horario por defecto. ¿Es el de tu negocio?')).toHaveCount(0)
})
