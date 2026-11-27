import type { ApiResponse } from '../../../frontend/src/shared/http/contract'
import { flow } from '../../fixtures/crm'
import { expect, test } from '../../fixtures/test'

type Template = ApiResponse<'/api/templates', 'get'>[number]

// La plantilla de bienvenida de Meta con dos botones de respuesta rápida: el
// caso de «Welcome Instagram» (2026-11-27), que solo dejaba seguir por «Siguiente».
const BIENVENIDA_META: Template = {
  id: 7, name: 'welcome_instagram', content: 'Hola {{1}}, gracias por escribirnos. ¿Quieres agendar tu evaluación?',
  shortcut: null, category: 'ventas', stage: null, task_type: null, service: null,
  is_active: true, visibility: 'global', template_type: 'official', official_name: 'welcome_instagram', official_language: 'es',
  official_category: 'MARKETING', official_status: 'APPROVED', official_rejected_reason: null, official_parameter_values: ['{{nombre}}'],
  meta_template_id: '900', official_last_edit_at: null, official_next_edit_at: null,
  official_header_type: 'none', official_header_text: null, official_header_media_asset_id: null, official_header_media_url: null,
  official_header_media_content_type: null, official_header_media_filename: null, official_footer: null,
  official_buttons: [{ type: 'quick_reply', text: 'Quiero agendar' }, { type: 'quick_reply', text: 'Solo información' }],
  interactive_type: 'none', interactive_config: {}, imported_from_meta: true, is_favorite: false, last_used_at: null, use_count: 12,
  created_by_user_id: 1, created_by_name: 'Admin', created_at: '2026-11-12T10:00:00Z', attachments: [],
}

const SEND = { type: 'send_template', template_id: BIENVENIDA_META.id }
const message = (id: string, y: number, text: string) => ({ id, type: 'action', position: { x: 780, y }, data: { action: { type: 'send_message', text } } })
const end = (id: string, y: number) => ({ id, type: 'end', position: { x: 1140, y }, data: { label: 'Fin', close_conversation: false } })

// Por JSON: el contrato tipa el flujo como JSON abierto, sin los literales.
/** Como estaba publicada: la plantilla sigue por su única salida. */
const UNA_SALIDA = JSON.parse(JSON.stringify({
  conditions: {},
  nodes: [
    { id: 'trigger-1', type: 'trigger', position: { x: 60, y: 200 }, data: { trigger_type: 'conversation_started' } },
    { id: 'plantilla', type: 'action', position: { x: 380, y: 200 }, data: { action: SEND } },
    end('end-1', 200),
  ],
  edges: [
    { id: 'e1', source: 'trigger-1', target: 'plantilla', source_handle: 'next' },
    { id: 'e2', source: 'plantilla', target: 'end-1', source_handle: 'next' },
  ],
}))

/** Con el ajuste encendido y cada salida conectada a su propia ruta. */
const POR_BOTON = JSON.parse(JSON.stringify({
  conditions: {},
  nodes: [
    { id: 'trigger-1', type: 'trigger', position: { x: 60, y: 240 }, data: { trigger_type: 'conversation_started' } },
    {
      id: 'plantilla', type: 'action', position: { x: 380, y: 160 },
      data: {
        action: SEND,
        reply: { buttons: [{ id: 'btn_1', label: 'Quiero agendar' }, { id: 'btn_2', label: 'Solo información' }], timeout_seconds: 86400 },
      },
    },
    message('agendar', 0, 'Perfecto {{nombre}}, ¿qué día te queda mejor?'),
    message('informacion', 190, 'Claro, te cuento cómo trabajamos.'),
    message('otra', 380, 'Gracias por tu mensaje, ya te atiende una asesora.'),
    message('silencio', 570, '¿Sigues ahí, {{nombre}}?'),
    end('end-1', 285),
  ],
  edges: [
    { id: 'e1', source: 'trigger-1', target: 'plantilla', source_handle: 'next' },
    { id: 'e2', source: 'plantilla', target: 'agendar', source_handle: 'btn_1' },
    { id: 'e3', source: 'plantilla', target: 'informacion', source_handle: 'btn_2' },
    { id: 'e4', source: 'plantilla', target: 'otra', source_handle: 'other' },
    { id: 'e5', source: 'plantilla', target: 'silencio', source_handle: 'timeout' },
    ...['agendar', 'informacion', 'otra', 'silencio'].map(id => ({ id: `fin-${id}`, source: id, target: 'end-1', source_handle: 'next' })),
  ],
}))

const automation = (id: number, name: string, definition: unknown) => ({
  ...flow(id, name),
  trigger_type: 'conversation_started' as const,
  flow_definition: definition as ReturnType<typeof flow>['flow_definition'],
  published_flow_definition: definition as ReturnType<typeof flow>['published_flow_definition'],
})

const PUBLICADA = automation(40, 'Welcome Instagram', UNA_SALIDA)
const CON_RUTAS = automation(41, 'Welcome Instagram por botón', POR_BOTON)

test.beforeEach(({ api }) => {
  api
    .on('get', '/api/automations', [PUBLICADA, CON_RUTAS])
    .on('get', '/api/templates', [BIENVENIDA_META])
    .on('get', '/api/users', [])
    .on('get', '/api/tags', [])
    .on('get', '/api/media-library', [])
})

test('una plantilla con botones de respuesta rápida puede seguir una ruta por botón', async ({ page }, info) => {
  await page.goto(`/automations?automatizacion=${PUBLICADA.id}&bloque=plantilla`)

  // Apagado por defecto: lo ya publicado sigue por «Siguiente».
  const toggle = page.getByRole('checkbox', { name: /Seguir según el botón que toque/ })
  await expect(toggle).not.toBeChecked()
  const exits = page.getByRole('region', { name: 'Sale hacia' })
  await expect(exits).toContainText('Siguiente')
  await toggle.scrollIntoViewIfNeeded()
  await page.screenshot({ path: `test-results/plantilla-segun-boton-apagado-${info.project.name}.png` })

  await toggle.check()

  // El paso espera la respuesta: pide el tiempo máximo (24 h por defecto) y
  // suelta la conexión de «Siguiente», que dejó de existir.
  await expect(page.getByText('Tiempo máximo para responder')).toBeVisible()
  await expect(page.getByRole('spinbutton', { name: 'Horas' })).toHaveValue('24')
  await expect(exits).toContainText('Sin conexiones.')
  await expect(page.getByText('Si el cliente no responde en este tiempo, el paso sigue por «Sin respuesta».')).toBeVisible()
  const step = page.locator('.react-flow__node').filter({ hasText: 'welcome_instagram' })
  for (const output of ['Quiero agendar', 'Solo información', 'Otra respuesta', 'Sin respuesta']) {
    await expect(step.getByText(output, { exact: true })).toBeAttached()
  }

  await toggle.uncheck()
  await expect(step.getByText('Otra respuesta', { exact: true })).toHaveCount(0)
})

test('el paso muestra una salida por botón, cada una hacia su ruta', async ({ page }, info) => {
  await page.goto(`/automations?automatizacion=${CON_RUTAS.id}&bloque=plantilla`)

  await expect(page.getByRole('checkbox', { name: /Seguir según el botón que toque/ })).toBeChecked()
  const exits = page.getByRole('region', { name: 'Sale hacia' })
  for (const output of ['Quiero agendar', 'Solo información', 'Otra respuesta', 'Sin respuesta']) {
    await expect(exits).toContainText(output)
  }
  await expect(exits).not.toContainText('Siguiente')
  // «Sin respuesta» dice cuánto espera, en el lienzo y en la lista de salidas.
  await expect(exits).toContainText('Sin respuesta tras 24h')
  await expect(page.locator('.react-flow__node').filter({ hasText: 'welcome_instagram' })).toContainText('tras 24h')
  // La plantilla no cambió desde que se armó el paso: no hay nada que actualizar.
  await expect(page.getByRole('button', { name: 'Actualizar botones' })).toHaveCount(0)
  await page.screenshot({ path: `test-results/plantilla-segun-boton-salidas-${info.project.name}.png` })
})
