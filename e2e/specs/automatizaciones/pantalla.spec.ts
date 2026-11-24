import { ADMIN, CHAT_ID, FLOWS, execution, flow } from '../../fixtures/crm'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

// Un negocio como DermicaPro: una automatización que corre sola y varias
// secuencias que el equipo lanza desde el chat.
const BIENVENIDA = { ...flow(20, 'Bienvenida'), trigger_type: 'conversation_started' as const }

/** El backend filtra por `status`; el simulado tiene que hacerlo también, o
 *  «Por atender» recibiría lo que es de «Actividad». */
function byStatus(rows: ReturnType<typeof execution>[]) {
  return ({ url }: { url: URL }) => {
    const status = url.searchParams.get('status')
    const delivery = url.searchParams.get('delivery')
    return rows
      .filter(row => !status || row.status === status)
      .filter(row => !delivery || (delivery === 'ok' ? row.delivery_state === null || row.delivery_state === 'delivered' : row.delivery_state === delivery))
  }
}

test.beforeEach(({ api }) => {
  api
    .on('get', '/api/automations', [BIENVENIDA, ...FLOWS])
    .on('get', '/api/users', [])
    .on('get', '/api/tags', [])
    .on('get', '/api/media-library', [])
})

test('todas las automatizaciones están en una lista y un filtro las separa por cómo empiezan', async ({ page }, info) => {
  await page.goto('/automations')

  // Eran dos secciones («Empiezan solas» y «Las lanza tu equipo») y se leían
  // como dos cosas distintas: es la misma con otro inicio.
  const tabs = page.getByRole('navigation', { name: 'Secciones de automatizaciones' })
  await expect(tabs.getByRole('button', { name: /Tus automatizaciones/ })).toHaveAttribute('aria-current', 'page')
  await expect(tabs.getByRole('button', { name: /Las lanza tu equipo/ })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: BIENVENIDA.name })).toBeVisible()
  await expect(page.getByRole('heading', { name: FLOWS[0].name })).toBeVisible()
  // Cada tarjeta dice cómo empieza, sin abrir el editor.
  await expect(page.getByRole('article').filter({ hasText: BIENVENIDA.name })).toContainText('Empieza sola')
  await expect(page.getByRole('article').filter({ hasText: FLOWS[0].name })).toContainText('La lanza tu equipo')
  // Sin pendientes, «Por atender» no lleva contador: un 0 se leería como aviso.
  await expect(tabs.getByRole('button', { name: 'Por atender', exact: true })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/automatizaciones-lista-unica-${info.project.name}.png` })

  const filter = page.getByRole('group', { name: 'Filtrar por cómo empiezan' })
  await filter.getByRole('button', { name: /Las lanza tu equipo/ }).click()
  await expect(page.getByRole('heading', { name: FLOWS[0].name })).toBeVisible()
  await expect(page.getByRole('heading', { name: BIENVENIDA.name })).toHaveCount(0)
  await filter.getByRole('button', { name: /Empiezan solas/ }).click()
  await expect(page.getByRole('heading', { name: BIENVENIDA.name })).toBeVisible()
  await expect(page.getByRole('heading', { name: FLOWS[0].name })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nueva automatización' })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/automatizaciones-filtro-${info.project.name}.png` })
})

test('la tarjeta dice qué otra automatización la lanza', async ({ page, api }, info) => {
  // «Bienvenida» lanza la secuencia de cada servicio y eso no se veía en
  // ningún lado: había que abrir el editor de cada una para enterarse.
  const definition = JSON.parse(JSON.stringify({
    conditions: {},
    nodes: [
      { id: 'trigger-1', type: 'trigger', position: { x: 70, y: 220 }, data: { trigger_type: 'conversation_started' } },
      { id: 'invoke-1', type: 'invoke_flow', position: { x: 390, y: 220 }, data: { flow_rule_id: FLOWS[0].id } },
      { id: 'end-1', type: 'end', position: { x: 710, y: 220 }, data: { label: 'Fin', close_conversation: false } },
    ],
    edges: [
      { id: 'e1', source: 'trigger-1', target: 'invoke-1', source_handle: 'next' },
      { id: 'e2', source: 'invoke-1', target: 'end-1', source_handle: 'next' },
    ],
  }))
  api.on('get', '/api/automations', [{ ...BIENVENIDA, flow_definition: definition, published_flow_definition: definition }, ...FLOWS])

  await page.goto('/automations')
  await page.getByRole('button', { name: /Las lanza tu equipo/ }).click()

  const launched = page.getByRole('article').filter({ hasText: FLOWS[0].name })
  await expect(launched).toContainText('También la lanza: «Bienvenida»')
  await expect(page.getByRole('article').filter({ hasText: FLOWS[1].name })).not.toContainText('También la lanza')
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/automatizaciones-tambien-la-lanza-${info.project.name}.png` })
})

test('«Por atender» junta lo que falló por causa y lo arregla desde la fila', async ({ page, api }, info) => {
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString()
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString()
  const rows = [
    execution(FLOWS[0], { id: 4001, status: 'failed', error_code: 'service_window_closed', error: 'Ventana cerrada', finished_at: hourAgo, lead_name: 'Valeria Quispe' }),
    execution(FLOWS[2], { id: 4002, status: 'failed', error: 'La plantilla ya no está aprobada', finished_at: hourAgo, lead_name: 'Paola Ríos' }),
    execution(BIENVENIDA, { id: 4003, status: 'failed', error: 'El lead no tiene vendedor asignado', finished_at: hourAgo, lead_name: 'Lucía Pérez' }),
    execution(FLOWS[1], { id: 4004, status: 'paused', paused_at: monthAgo, lead_name: 'Jimena Castro' }),
    // Una pausa de hoy es una decisión reciente: no pide atención.
    execution(FLOWS[3], { id: 4005, status: 'paused', paused_at: hourAgo, lead_name: 'Rosa Díaz' }),
  ]
  api
    .on('get', '/api/automations/executions', byStatus(rows))
    .on('post', '/api/automations/executions/{execution_id}/retry', { ...rows[1], status: 'scheduled' })
    .on('get', '/api/chats/sellers', [{ id: 31, name: 'Ana Quispe', role: 'vendedor' }])
    .on('patch', '/api/chats/{chat_id}', () => ({ status: 200, body: {} }))
    .on('post', '/api/automations/executions/{execution_id}/dismiss', { ...rows[2], attention_dismissed_at: new Date().toISOString() })

  await page.goto('/automations')
  const tab = page.getByRole('navigation', { name: 'Secciones de automatizaciones' }).getByRole('button', { name: /Por atender/ })
  // Con pendientes se entra directo acá: es lo único que se degrada en silencio.
  await expect(tab).toHaveAttribute('aria-current', 'page')
  await expect(tab).toContainText('4')

  const failed = page.getByRole('region', { name: /Se cortaron por un error/ })
  await expect(page.getByRole('region', { name: /Frenadas por la ventana de 24 horas/ })).toContainText('Valeria Quispe')
  await expect(failed).toContainText('La plantilla ya no está aprobada')
  await expect(page.getByRole('region', { name: /Falta una vendedora/ })).toContainText('Lucía Pérez')
  await expect(page.getByRole('region', { name: /En pausa hace más de 7 días/ })).toContainText('Jimena Castro')
  await expect(page.getByText('Rosa Díaz')).toHaveCount(0)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/automatizaciones-por-atender-${info.project.name}.png`, fullPage: true })

  await failed.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByText('Ejecución reprogramada')).toBeVisible()
  expect(api.calls('post', '/api/automations/executions/{execution_id}/retry').map(call => call.path))
    .toEqual(['/api/automations/executions/4002/retry'])

  // «Falta una vendedora» se arregla ahí mismo: reintentar a secas volvía a
  // fallar, y antes había que ir al chat, asignarla y volver.
  const noSeller = page.getByRole('region', { name: /Falta una vendedora/ })
  await expect(noSeller.getByRole('button', { name: 'Asignar y reintentar' })).toBeDisabled()
  await noSeller.getByRole('combobox', { name: 'Vendedora para este lead' }).click()
  await page.getByRole('option', { name: 'Ana Quispe' }).click()
  await noSeller.getByRole('button', { name: 'Asignar y reintentar' }).click()
  await expect(page.getByText('Vendedora asignada y ejecución reprogramada')).toBeVisible()
  expect(api.calls('patch', '/api/chats/{chat_id}').map(call => call.body)).toEqual([{ vendedor_id: 31 }])
  expect(api.calls('post', '/api/automations/executions/{execution_id}/retry').map(call => call.path))
    .toEqual(['/api/automations/executions/4002/retry', '/api/automations/executions/4003/retry'])

  // Un fallo con el que no hay nada que hacer se descarta: sin eso la lista
  // no se vaciaba nunca.
  await page.getByRole('button', { name: 'Descartar el aviso de Lucía Pérez' }).click()
  await expect(page.getByText('Aviso descartado')).toBeVisible()
  expect(api.calls('post', '/api/automations/executions/{execution_id}/dismiss').map(call => call.path))
    .toEqual(['/api/automations/executions/4003/dismiss'])
})

test('sin nada pendiente, «Por atender» lo dice en vez de quedar en blanco', async ({ page }) => {
  await page.goto('/automations')
  await page.getByRole('navigation', { name: 'Secciones de automatizaciones' }).getByRole('button', { name: 'Por atender' }).click()

  await expect(page.getByText('Todo en marcha')).toBeVisible()
  await page.getByRole('button', { name: 'Ver la actividad' }).click()
  await expect(page.getByRole('button', { name: 'Actividad' })).toHaveAttribute('aria-current', 'page')
})

test('pausar un flujo pide confirmación y dice qué pasa con lo que está en curso', async ({ page, api }, info) => {
  const target = FLOWS[0]
  api.on('patch', '/api/automations/{rule_id}', { ...target, is_active: false })

  await page.goto('/automations')
  await page.getByRole('button', { name: /Las lanza tu equipo/ }).click()
  await page.getByRole('switch', { name: `Pausar ${target.name}` }).click()

  const dialog = page.getByRole('alertdialog', { name: `Pausar “${target.name}”` })
  await expectFullyOnScreen(dialog)
  await expect(dialog).toContainText('no recibirán los pasos que faltan')
  await page.screenshot({ path: `test-results/automatizaciones-pausar-${info.project.name}.png` })

  // Arrepentirse no toca nada: era un clic directo junto a «Eliminar».
  await dialog.getByRole('button', { name: 'No pausar' }).click()
  expect(api.calls('patch', '/api/automations/{rule_id}')).toEqual([])

  await page.getByRole('switch', { name: `Pausar ${target.name}` }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Pausar', exact: true }).click()
  expect(api.calls('patch', '/api/automations/{rule_id}')).toEqual([
    { method: 'patch', path: `/api/automations/${target.id}`, body: { is_active: false } },
  ])
})

test('la actividad dice cuántas hay en total y deja cargar más', async ({ page, api }, info) => {
  // El listado traía 200 como máximo y los días normales superan las 300:
  // se leía «200 resultados» como si fuera todo, sin forma de ver el resto.
  const all = Array.from({ length: 320 }, (_, index) => execution(FLOWS[index % FLOWS.length], { id: 1000 + index, status: 'completed' }))
  api
    .on('get', '/api/automations/executions', ({ url }) => (
      url.searchParams.get('status') ? [] : all.slice(0, Number(url.searchParams.get('limit') ?? 200))
    ))
    .on('get', '/api/automations/executions/count', ({ url }) => ({ total: url.searchParams.get('status') ? 0 : all.length }))

  // El enlace viejo (`?tab=history`) sigue llevando a la actividad.
  await page.goto('/automations?tab=history')

  const notice = page.getByRole('status').filter({ hasText: 'Se muestran las 200 más recientes de 320' })
  // La cabecera de la página lo deja bajo el pliegue en el celular.
  await notice.scrollIntoViewIfNeeded()
  await expectFullyOnScreen(notice)
  await expect(page.getByText('200 de 320', { exact: true })).toBeVisible()
  await page.screenshot({ path: `test-results/automatizaciones-historial-${info.project.name}.png` })

  await notice.getByRole('button', { name: 'Cargar 200 más' }).click()

  // Ya están todas: se va el aviso y el contador dice el total.
  await expect(page.getByText('320 resultados', { exact: true })).toBeVisible()
  await expect(notice).toHaveCount(0)
})

test('la actividad distingue lo que alguien canceló de lo que no aplicó', async ({ page, api }, info) => {
  // Las dos se guardaban como «skipped» y se leían «Omitida»: en DermicaPro
  // 655 de 718 eran cancelaciones, no flujos que no aplicaban.
  api.on('get', '/api/automations/executions', byStatus([
    execution(FLOWS[0], { id: 2001, status: 'cancelled', error: 'Cancelada manualmente', finished_at: new Date().toISOString() }),
    execution(FLOWS[1], { id: 2002, status: 'skipped', error: 'El cliente respondió antes del vencimiento', finished_at: new Date().toISOString() }),
  ]))

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

test('la actividad dice quién lanzó cada una y nunca muestra un uuid', async ({ page, api }, info) => {
  // Decía «Ejecutada por Otro flujo» y, si el lead no tenía nombre, su uuid:
  // la dueña no sabía ni a quién se le envió ni qué lo envió.
  const done = { status: 'completed' as const, finished_at: new Date().toISOString() }
  api.on('get', '/api/automations/executions', byStatus([
    execution(FLOWS[0], { ...done, id: 5001, start_source: 'flow', parent_rule_id: BIENVENIDA.id, parent_rule_name: BIENVENIDA.name, lead_name: null }),
    execution(FLOWS[1], { ...done, id: 5002, start_source: 'manual', started_by_name: 'Ana Quispe', lead_name: null, lead_phone: null }),
    execution(BIENVENIDA, { ...done, id: 5003, start_source: 'system', trigger_type: 'conversation_started', started_by_name: null, started_by_user_id: null }),
  ]))

  await page.goto('/automations?tab=history')

  const byFlow = page.locator('details').filter({ hasText: FLOWS[0].name })
  await expect(byFlow).toContainText('51987654321 · La lanzó «Bienvenida»')
  await expect(page.locator('details').filter({ hasText: FLOWS[1].name })).toContainText('Lead sin nombre · La lanzó Ana Quispe')
  await expect(page.locator('details').filter({ hasText: 'Empezó sola' })).toContainText('Josefina Paredes')
  await expect(page.getByText(CHAT_ID)).toHaveCount(0)
  await byFlow.scrollIntoViewIfNeeded()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/automatizaciones-quien-la-lanzo-${info.project.name}.png` })
})

test('si la lista no carga lo dice y deja reintentar, en vez de parecer vacía', async ({ page, api }, info) => {
  // Un fallo se veía igual que «Todavía no hay automatizaciones»: la dueña
  // creía haber perdido las suyas.
  api.fail('get', '/api/automations', 500)

  await page.goto('/automations')

  const failure = page.getByRole('alert').filter({ hasText: 'No se pudieron cargar las automatizaciones' })
  await expect(failure).toBeVisible({ timeout: 20_000 })
  await expect(page.getByText('Todavía no hay automatizaciones')).toHaveCount(0)
  await expectFullyOnScreen(failure)
  await page.screenshot({ path: `test-results/automatizaciones-fallo-de-carga-${info.project.name}.png` })

  api.on('get', '/api/automations', [BIENVENIDA, ...FLOWS])
  await failure.getByRole('button', { name: 'Reintentar' }).click()
  await expect(page.getByRole('heading', { name: BIENVENIDA.name })).toBeVisible()
})

test('el aviso de llamadas se puede apartar para llegar a los botones que tapaba', async ({ page, api }, info) => {
  // Flotaba sobre «Nueva automatización» y el panel del editor sin forma de
  // cerrarlo. Se pliega a un botón: sin preparar, las llamadas no suenan.
  api
    .on('get', '/api/auth/me', { ...ADMIN, can_handle_calls: true })
    .on('get', '/api/calls/ringing', [])

  await page.goto('/automations')

  const notice = page.getByRole('region', { name: 'Preparar este dispositivo para llamadas' })
  await expect(notice).toBeVisible()
  await page.screenshot({ path: `test-results/automatizaciones-aviso-llamadas-${info.project.name}.png` })
  await notice.getByRole('button', { name: 'Ahora no' }).click()
  await expect(notice).toHaveCount(0)
  await page.screenshot({ path: `test-results/automatizaciones-aviso-llamadas-plegado-${info.project.name}.png` })

  await page.getByRole('button', { name: 'Nueva automatización' }).click()
  await expect(page.getByRole('dialog', { name: '¿Qué quieres automatizar?' })).toBeVisible()
})

test('crear empieza por elegir una receta y abre el editor con el flujo ya armado', async ({ page, api }, info) => {
  await page.goto('/automations')
  await page.getByRole('button', { name: /Las lanza tu equipo/ }).click()
  await page.getByRole('button', { name: 'Nueva automatización' }).click()

  // Antes se abría directo un lienzo con «Lead nuevo → Crear tarea → Fin»,
  // que no era lo que nadie venía a hacer.
  const picker = page.getByRole('dialog', { name: '¿Qué quieres automatizar?' })
  await expectFullyOnScreen(picker.getByRole('button', { name: /Enviar precios/ }))
  await expect(picker.getByRole('button', { name: /Dar la bienvenida/ })).toBeVisible()
  await expect(picker.getByRole('button', { name: /Empezar de cero/ })).toBeVisible()
  await page.screenshot({ path: `test-results/automatizaciones-recetas-${info.project.name}.png` })

  await picker.getByRole('button', { name: /Enviar precios/ }).click()

  await expect(picker).toBeHidden()
  // El editor abre con el nombre y los mensajes de la receta.
  await expect.poll(() => page.locator('input').evaluateAll(inputs => inputs.map(input => (input as HTMLInputElement).value)))
    .toContain('Precio de …')
  // Elegir una receta no crea nada: el flujo nace sin guardar.
  expect(api.calls('post', '/api/automations/flows')).toEqual([])
  await page.screenshot({ path: `test-results/automatizaciones-receta-editor-${info.project.name}.png` })
})

test('una completada cuyo mensaje no salió se lee «No se entregó» y pide atención', async ({ page, api }, info) => {
  // «Completada» significaba «recorrió sus pasos». Había completadas con
  // mensajes que nunca le llegaron al cliente y se leían igual que las demás.
  const now = new Date().toISOString()
  const rows = [
    execution(FLOWS[0], { id: 5001, status: 'completed', delivery_state: 'delivered', finished_at: now, lead_name: 'Ana Torres' }),
    execution(FLOWS[1], {
      id: 5002, status: 'completed', delivery_state: 'failed', finished_at: now, lead_name: 'Carla Méndez',
      action_results: [
        { position: 1, type: 'send_message', status: 'completed', message_ids: [901] },
        { position: 2, type: 'send_message', status: 'completed', message_ids: [902] },
      ],
    }),
    execution(FLOWS[2], { id: 5003, status: 'completed', delivery_state: 'pending', finished_at: now, lead_name: 'Sofía Luna' }),
  ]
  api
    .on('get', '/api/automations/executions', byStatus(rows))
    .on('get', '/api/automations/executions/count', ({ url }) => ({ total: byStatus(rows)({ url }).length }))
    .on('post', '/api/chats/{chat_id}/messages/{message_id}/retry', () => ({ status: 200, body: {} }))
    .on('get', '/api/automations/executions/{execution_id}/messages', [
      { message_id: 901, state: 'read' },
      { message_id: 902, state: 'failed' },
    ])

  // Con un mensaje sin entregar hay algo que atender: se entra ahí.
  await page.goto('/automations')
  const group = page.getByRole('region', { name: /Mensajes que no se entregaron/ })
  await expect(group).toContainText('Carla Méndez')
  await expect(group.getByRole('button', { name: 'Ir al chat' })).toBeVisible()
  // Con el detalle cerrado todavía no se pidió el estado de ningún mensaje.
  expect(api.calls('get', '/api/automations/executions/{execution_id}/messages')).toEqual([])
  // Reenviar vuelve a mandar justo el mensaje que no salió, no todo el flujo.
  await group.getByRole('button', { name: 'Reenviar' }).click()
  await expect(page.getByText('Mensaje reenviado')).toBeVisible()
  expect(api.calls('post', '/api/chats/{chat_id}/messages/{message_id}/retry').map(call => call.path))
    .toEqual([`/api/chats/${CHAT_ID}/messages/902/retry`])
  await expect(page.getByText('Ana Torres')).toHaveCount(0)

  await page.getByRole('navigation', { name: 'Secciones de automatizaciones' }).getByRole('button', { name: 'Actividad' }).click()
  const row = (name: string) => page.locator('details').filter({ hasText: name })
  await expect(row('Ana Torres').getByText('Completada', { exact: true })).toBeVisible()
  await expect(row('Carla Méndez').getByText('No se entregó', { exact: true })).toBeVisible()
  await expect(row('Sofía Luna').getByText('Enviando…', { exact: true })).toBeVisible()
  // Al abrir el detalle, cada mensaje con su marca, como en WhatsApp: se ve
  // cuál de los dos fue el que no llegó.
  await row('Carla Méndez').locator('summary').click()
  await expect(row('Carla Méndez').getByText('Leído', { exact: true })).toBeVisible()
  await expect(row('Carla Méndez').getByText('No se entregó', { exact: true })).toHaveCount(2)
  await row('Carla Méndez').scrollIntoViewIfNeeded()
  await page.screenshot({ path: `test-results/automatizaciones-entrega-${info.project.name}.png` })
  await row('Carla Méndez').locator('summary').click()

  // El filtro trae exactamente lo que la etiqueta muestra.
  // Por rol: «Estado» también es la etiqueta de las opciones de la lista
  // mientras se cierra, y getByLabel las alcanzaba a las dos.
  const statusFilter = page.getByRole('combobox', { name: 'Estado' })
  await statusFilter.click()
  await page.getByRole('option', { name: 'No se entregó', exact: true }).click()
  await expect(page.getByRole('option')).toHaveCount(0)
  await expect(row('Carla Méndez')).toBeVisible()
  await expect(row('Ana Torres')).toHaveCount(0)
  await statusFilter.click()
  await page.getByRole('option', { name: 'Completada', exact: true }).click()
  await expect(row('Ana Torres')).toBeVisible()
  await expect(row('Carla Méndez')).toHaveCount(0)
})
