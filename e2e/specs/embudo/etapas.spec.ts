import { chat } from '../../fixtures/crm'
import { expectNoPageOverflow } from '../../fixtures/screen'
import type { Locator, Page } from '@playwright/test'
import { expect, test } from '../../fixtures/test'

const STAGES = [
  ['nuevo', 'Nuevo', '#0ea5e9', 'open'],
  ['calificado', 'Calificado', '#06b6d4', 'open'],
  ['oferta_presentada', 'Oferta presentada', '#8b5cf6', 'open'],
  ['agendado', 'Agendado', '#3b82f6', 'open'],
  ['en_seguimiento', 'En seguimiento', '#64748b', 'open'],
  ['cliente_activo', 'Cliente activo', '#22c55e', 'won'],
  ['perdido', 'Perdido', '#f43f5e', 'lost'],
] as const

const NAMES = ['Josefina Paredes', 'Lucía Fernández', 'Mariana Quispe', 'Carla Rojas', 'Valeria Gómez', 'Andrea Salazar']

function leadsIn(stage: string, count: number) {
  return Array.from({ length: count }, (_, index) => chat({
    chat_id: `5199900${stage.length}${index}`,
    phone: `5199900${stage.length}${index}`,
    name: NAMES[index % NAMES.length],
    stage,
    unread_count: index === 0 ? 2 : 0,
    last_message: 'Hola, quería saber el precio del tratamiento y si tienen horarios el sábado',
  }))
}

/** El embudo arranca en el tablero: las pruebas de la lista la eligen. */
async function abrirLista(page: Page) {
  await page.goto('/kanban')
  await page.getByRole('group', { name: 'Vista del embudo' }).getByRole('button', { name: 'Lista' }).click()
}

test.beforeEach(async ({ api }) => {
  const counts = { nuevo: 6, calificado: 3, oferta_presentada: 2, agendado: 4, en_seguimiento: 0, cliente_activo: 5, perdido: 1 }
  api
    .on('get', '/api/lead-stages', STAGES.map(([key, name, color, kind], position) => ({
      key, name, color, kind, position, is_active: true, description: null, is_system: key === 'nuevo', on_appointment: false,
    })))
    .on('get', '/api/tags', [])
    .on('get', '/api/chats/kanban/snapshot', {
      counts,
      stages: Object.fromEntries(Object.entries(counts).map(([stage, total]) => [stage, { items: leadsIn(stage, total), has_more: false }])),
    })
})

test('el embudo lista las etapas a un lado y muestra solo los leads de la elegida', async ({ page }, info) => {
  await abrirLista(page)
  await expect(page.getByRole('heading', { name: 'Embudo comercial' })).toBeVisible()

  // Arranca en la primera etapa con leads, sin columnas cortadas a los lados.
  const lista = page.getByRole('list', { name: 'Leads en Nuevo' })
  await expect(lista.getByRole('listitem')).toHaveCount(6)
  // El tratamiento y la persona asignada se ven en cualquier ancho: en la
  // primera versión de la lista solo aparecían en pantallas anchas.
  const fila = lista.getByRole('listitem').first()
  await expect(fila.getByText('HIFU 12D')).toBeVisible()
  await expect(fila.getByText('Admin', { exact: true })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/embudo-${info.project.name}.png` })

  await page.getByRole('navigation', { name: 'Etapas del embudo' }).locator('visible=true')
    .getByRole('button', { name: /^Agendado, 4 leads/ }).click()
  await expect(page.getByRole('list', { name: 'Leads en Agendado' }).getByRole('listitem')).toHaveCount(4)
  // La etapa queda en la URL para volver a ella después de abrir un chat.
  await expect(page).toHaveURL(/etapa=agendado/)
  await page.screenshot({ path: `test-results/embudo-agendado-${info.project.name}.png` })
})

test('el embudo arranca en el tablero y quien prefiere la lista la elige y se le recuerda', async ({ page }, info) => {
  await page.goto('/kanban')
  const vista = page.getByRole('group', { name: 'Vista del embudo' })
  const botones = vista.getByRole('button')
  // Tablero va primero: es la vista por defecto.
  await expect(botones.first()).toHaveAccessibleName('Tablero')
  await expect(vista.getByRole('button', { name: 'Tablero' })).toHaveAttribute('aria-pressed', 'true')
  const tablero = page.getByRole('region', { name: 'Etapas del embudo comercial' })
  await expect(tablero.getByRole('region', { name: /^Nuevo, 6 leads/ })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/embudo-tablero-${info.project.name}.png` })

  await vista.getByRole('button', { name: 'Lista' }).click()
  await expect(page.getByRole('list', { name: 'Leads en Nuevo' })).toBeVisible()
  await page.reload()
  await expect(vista.getByRole('button', { name: 'Lista' })).toHaveAttribute('aria-pressed', 'true')
  await expect(tablero).toHaveCount(0)
})

test('arrastrar un lead tras bajar en la lista mueve solo ese lead', async ({ page, api }, info) => {
  test.skip(info.project.name !== 'escritorio', 'En el celular las etapas son chips y se mueve con el selector')
  const nuevos = leadsIn('nuevo', 20)
  api
    .on('get', '/api/chats/kanban/snapshot', {
      counts: { nuevo: 20, agendado: 0 },
      stages: { nuevo: { items: nuevos, has_more: false }, agendado: { items: [], has_more: false } },
    })
    .on('patch', '/api/chats/{chat_id}/stage', ({ url }) => ({ ...nuevos[8], stage: 'agendado', chat_id: url.pathname.split('/')[3] }))

  await abrirLista(page)
  const lista = page.getByRole('list', { name: 'Leads en Nuevo' })
  const fila = lista.getByRole('listitem').nth(8)
  // Antes, con la lista bajada, la imagen del arrastre arrastraba varias filas.
  await fila.scrollIntoViewIfNeeded()
  await fila.dragTo(page.getByRole('navigation', { name: 'Etapas del embudo' }).locator('visible=true')
    .getByRole('button', { name: /^Agendado, 0 leads/ }))

  await expect.poll(() => api.calls('patch', '/api/chats/{chat_id}/stage').length).toBe(1)
  const [llamada] = api.calls('patch', '/api/chats/{chat_id}/stage')
  expect(llamada.path).toBe(`/api/chats/${nuevos[8].chat_id}/stage`)
  expect(llamada.body).toMatchObject({ stage: 'agendado' })
})

test('en el tablero, arrastrar una tarjeta a otra columna mueve solo ese lead', async ({ page, api }, info) => {
  test.skip(info.project.name !== 'escritorio', 'El arrastre entre columnas se prueba en escritorio')
  const nuevos = leadsIn('nuevo', 3)
  api
    .on('get', '/api/chats/kanban/snapshot', {
      counts: { nuevo: 3, calificado: 0 },
      stages: { nuevo: { items: nuevos, has_more: false }, calificado: { items: [], has_more: false } },
    })
    .on('patch', '/api/chats/{chat_id}/stage', { ...nuevos[1], stage: 'calificado' })

  await page.goto('/kanban')
  const tablero = page.getByRole('region', { name: 'Etapas del embudo comercial' })
  const tarjeta = tablero.getByRole('region', { name: /^Nuevo, 3 leads/ }).getByRole('article').nth(1)
  await tarjeta.dragTo(tablero.getByRole('region', { name: /^Calificado, 0 leads/ }))

  await expect.poll(() => api.calls('patch', '/api/chats/{chat_id}/stage').length).toBe(1)
  expect(api.calls('patch', '/api/chats/{chat_id}/stage')[0].path).toBe(`/api/chats/${nuevos[1].chat_id}/stage`)
})

test('al seleccionar, las acciones aparecen al pie y el buscador sigue a mano', async ({ page, api }, info) => {
  api.on('get', '/api/tags', [{ id: 1, name: 'VIP', color: '#f43f5e', is_active: true, created_by_user_id: null, created_by_name: null, created_at: null }])
  await abrirLista(page)
  const lista = page.getByRole('list', { name: 'Leads en Nuevo' })
  const antes = await lista.boundingBox()

  await lista.getByRole('button', { name: 'Seleccionar Josefina Paredes' }).first().click()
  const barra = page.getByRole('region', { name: 'Acciones sobre los leads seleccionados' })
  // Como en la bandeja de chats: el conteo y "Cancelar" arriba, en la fila de
  // la etapa; abajo solo las acciones.
  await expect(page.getByRole('status').filter({ hasText: '1 seleccionado' })).toBeVisible()
  await expect(barra.getByRole('button', { name: 'Cancelar' })).toHaveCount(0)
  // La misma barra que la bandeja de chats: menús que abren hacia arriba.
  await expect(barra.getByRole('button', { name: 'Mover 1 lead a otra etapa' })).toBeVisible()
  await expect(barra.getByRole('button', { name: 'Agregar etiqueta a 1 lead' })).toBeVisible()
  // Antes la barra reemplazaba la cabecera y tapaba el buscador.
  await expect(page.getByRole('searchbox', { name: 'Buscar leads' })).toBeVisible()
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/embudo-seleccion-${info.project.name}.png` })

  // La barra va debajo de la lista: la lista no se corre hacia abajo.
  const despues = await lista.boundingBox()
  expect(despues?.y).toBe(antes?.y)
  const caja = await barra.boundingBox()
  expect(caja!.y).toBeGreaterThan(despues!.y)

  // La casilla de arriba marca la página entera.
  await page.getByRole('button', { name: 'Seleccionar todos' }).click()
  await expect(page.getByRole('status').filter({ hasText: '6 seleccionados' })).toBeVisible()

  await page.getByRole('button', { name: 'Cancelar', exact: true }).click()
  await expect(barra).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Nuevo' })).toBeVisible()
})

test('la lista pagina por 10, 20 o 50 y recuerda las filas elegidas', async ({ page }, info) => {
  const nuevos = leadsIn('nuevo', 55)
  for (const [index, lead] of nuevos.entries()) lead.name = `Lead ${index + 1}`
  await page.route(/\/api\/chats\/kanban\/snapshot/, (route) => route.fulfill({
    json: { counts: { nuevo: 55 }, stages: { nuevo: { items: nuevos.slice(0, 40), has_more: true } } },
  }))
  const pedidos: string[] = []
  await page.route(/\/api\/chats\/kanban\/nuevo/, (route) => {
    const url = new URL(route.request().url())
    pedidos.push(url.search)
    const offset = Number(url.searchParams.get('offset'))
    const limit = Number(url.searchParams.get('limit'))
    return route.fulfill({ json: { items: nuevos.slice(offset, offset + limit), has_more: offset + limit < 55 } })
  })

  await abrirLista(page)
  const lista = page.getByRole('list', { name: 'Leads en Nuevo' })
  const paginacion = page.getByRole('navigation', { name: 'Paginación de leads' })
  await expect(lista.getByRole('listitem')).toHaveCount(10)
  await expect(paginacion.getByText(/^1–10 de 55/)).toBeVisible()
  // Una sola fila también en el celular: en dos se comía alto de la lista.
  expect((await paginacion.boundingBox())!.height).toBeLessThan(56)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/embudo-paginacion-${info.project.name}.png` })

  // La página 2 ya vino en el snapshot: no hace falta pedirla.
  await paginacion.getByRole('button', { name: 'Página siguiente' }).click()
  await expect(lista.getByText('Lead 11', { exact: true })).toBeVisible()
  expect(pedidos).toEqual([])

  // La última sí se pide al servidor, con su offset y su tamaño.
  if (info.project.name === 'celular') {
    // En el celular no están "primera" y "última": se llega por los números.
    await expect(paginacion.getByRole('button', { name: 'Última página' })).toBeHidden()
    for (const numero of [3, 4, 5, 6]) {
      await paginacion.getByRole('button', { name: 'Página siguiente' }).click()
      await expect(paginacion.getByRole('button', { name: `Página ${numero}` })).toHaveAttribute('aria-current', 'page')
    }
  } else {
    await paginacion.getByRole('button', { name: 'Última página' }).click()
  }
  await expect(lista.getByRole('listitem')).toHaveCount(5)
  await expect(paginacion.getByText(/^51–55 de 55/)).toBeVisible()
  expect(pedidos.at(-1)).toContain('offset=50')

  await paginacion.getByRole('combobox', { name: 'Filas por página' }).click()
  await page.getByRole('option', { name: '50', exact: true }).click()
  await expect(lista.getByRole('listitem')).toHaveCount(50)
  await expect(paginacion.getByText(/^1–50 de 55/)).toBeVisible()

  await page.reload()
  await expect(page.getByRole('list', { name: 'Leads en Nuevo' }).getByRole('listitem')).toHaveCount(50)
})

// En el Chrome de la clínica (Windows) el desplazamiento propio del navegador
// al arrastrar se trababa; el embudo ahora se desplaza por su cuenta a partir
// de los `dragover`. El Chromium de Playwright no entrega `dragover` a la
// página al mover el mouse durante un arrastre (sí desplaza por su cuenta,
// lo que escondería un fallo nuestro), así que acá el arrastre se inicia de
// verdad y los `dragover` se emiten a mano con la posición del puntero.
// El mouse real se queda donde empezó el arrastre, lejos de los bordes, para
// que el desplazamiento del propio navegador no haga pasar la prueba.
async function arrastrarSobre(page: Page, x: number, y: number) {
  await page.evaluate(([clientX, clientY]) => {
    document.dispatchEvent(new DragEvent('dragover', { clientX, clientY, bubbles: true, cancelable: true }))
  }, [x, y])
}

/** Inicia un arrastre real (para que el embudo sepa que hay un lead en el aire). */
async function empezarArrastre(page: Page, origen: Locator) {
  await origen.hover()
  await page.mouse.down()
  const caja = (await origen.boundingBox())!
  await page.mouse.move(caja.x + caja.width / 2 + 10, caja.y + caja.height / 2 + 10, { steps: 3 })
}

test.describe('al arrastrar cerca del borde, el embudo se desplaza solo', () => {
  test.skip(({ isMobile }) => isMobile, 'Con el mouse: en el celular no se arrastra con el dedo')

  test('la lista baja y sube sin atinar a un punto exacto', async ({ page, api }) => {
    const nuevos = leadsIn('nuevo', 10)
    api.on('get', '/api/chats/kanban/snapshot', {
      counts: { nuevo: 10, agendado: 0 },
      stages: { nuevo: { items: nuevos, has_more: false }, agendado: { items: [], has_more: false } },
    })
    await abrirLista(page)
    const lista = page.getByRole('list', { name: 'Leads en Nuevo' })
    const contenedor = lista.locator('xpath=..')
    const caja = (await contenedor.boundingBox())!
    const maximo = await contenedor.evaluate((el) => el.scrollHeight - el.clientHeight)
    expect(maximo).toBeGreaterThan(0)
    const centroX = caja.x + caja.width / 2

    await empezarArrastre(page, lista.getByRole('listitem').first())
    // Debajo de la lista, sobre la paginación: igual baja hasta el final.
    await arrastrarSobre(page, centroX, caja.y + caja.height + 20)
    await expect.poll(() => contenedor.evaluate((el) => el.scrollTop), { timeout: 4000 }).toBeGreaterThanOrEqual(maximo - 2)
    // Sobre la cabecera de la etapa: sube hasta arriba.
    await arrastrarSobre(page, centroX, caja.y - 20)
    await expect.poll(() => contenedor.evaluate((el) => el.scrollTop), { timeout: 4000 }).toBe(0)
    await page.mouse.up()
  })

  test('la lista de etapas se desplaza para llegar a la de abajo', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 420 })
    await abrirLista(page)
    const etapas = page.getByRole('navigation', { name: 'Etapas del embudo' }).locator('visible=true')
    const caja = (await etapas.boundingBox())!
    expect(await etapas.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true)

    await empezarArrastre(page, page.getByRole('list', { name: 'Leads en Nuevo' }).getByRole('listitem').first())
    await arrastrarSobre(page, caja.x + caja.width / 2, caja.y + caja.height - 10)
    await expect(etapas.getByRole('button', { name: /^Perdido, 1 lead/ })).toBeInViewport()
    await page.mouse.up()
  })

  test('el tablero avanza de lado sin trabarse', async ({ page }) => {
    await page.goto('/kanban')
    const tablero = page.getByRole('region', { name: 'Etapas del embudo comercial' })
    const caja = (await tablero.boundingBox())!
    const maximo = await tablero.evaluate((el) => el.scrollWidth - el.clientWidth)
    expect(maximo).toBeGreaterThan(0)

    await empezarArrastre(page, tablero.getByRole('region', { name: /^Nuevo, 6 leads/ }).getByRole('article').first())
    await arrastrarSobre(page, caja.x + caja.width - 8, caja.y + 200)
    // Pegado al borde derecho: llega hasta el final, no solo unos píxeles.
    await expect.poll(() => tablero.evaluate((el) => el.scrollLeft), { timeout: 4000 }).toBeGreaterThanOrEqual(maximo - 2)
    await page.mouse.up()
  })
})
