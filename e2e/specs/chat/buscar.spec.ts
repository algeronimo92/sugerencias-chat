import type { ApiResponse } from '../../../frontend/src/shared/http/contract'
import { ADMIN, chat } from '../../fixtures/crm'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

type MessageHits = ApiResponse<'/api/chats/message-search', 'get'>

const PAOLA = '51983049189'
const ROCIO = '51999000222'

// Un lead que tiene "Limpieza Facial" como servicio (su último mensaje habla
// de otra cosa) y tres mensajes que lo dicen, dos del mismo chat.
const CONTACT = chat({
  chat_id: ROCIO, phone: ROCIO, name: 'Rocío Mendoza', servicio_interes: 'Limpieza Facial',
  last_message: 'Le gustaría una cita para hoy o mañana?', search_rank: 1,
})
const HITS: MessageHits = {
  items: [
    { message_id: 301, chat_id: PAOLA, name: 'Paola', username: 'paoocx.r', phone: PAOLA, sender: 'vendedor', message_type: 'text', sent_at: '2026-11-11T15:35:00Z', text: 'PROMOCIÓN LIMPIEZA FACIAL A SOLO 100 SOLES ‼️ Incluye extracción' },
    { message_id: 302, chat_id: ROCIO, name: 'Rocío Mendoza', username: null, phone: ROCIO, sender: 'vendedor', message_type: 'text', sent_at: '2026-11-11T15:33:00Z', text: 'Incluye limpieza profunda facial, una capa de carbón activado y láser' },
    { message_id: 303, chat_id: PAOLA, name: 'Paola', username: 'paoocx.r', phone: PAOLA, sender: 'cliente', message_type: 'text', sent_at: '2026-11-10T15:23:00Z', text: 'cuáles son los precios de las limpiezas faciales? ☺️' },
  ],
  has_more: false,
  total: 3,
  total_capped: false,
}

test('buscar un texto muestra contactos y mensajes por separado, y abre el mensaje elegido', async ({ page, api, isMobile }) => {
  const searchedIn: (string | null)[] = []
  api
    .on('get', '/api/chats', ({ url }) => {
      if (!url.searchParams.get('search')) return { items: [chat()], has_more: false, total: null }
      searchedIn.push(url.searchParams.get('search_in'))
      return { items: [CONTACT], has_more: false, total: 1 }
    })
    .on('get', '/api/chats/message-search', HITS)
    .on('get', '/api/chats/{chat_id}', chat({ chat_id: PAOLA, phone: PAOLA, name: 'Paola', username: 'paoocx.r', vendedor: ADMIN.name }))

  await page.goto('/')
  await page.getByPlaceholder('Buscar nombre, teléfono o mensaje').fill('LIMPIEZA FACIAL')

  // Las dos secciones, cada una con su total.
  const contacts = page.getByRole('region', { name: /^Contactos/ })
  const messages = page.getByRole('region', { name: /^Mensajes/ })
  await expect(contacts.getByRole('heading')).toHaveText('Contactos· 1')
  await expect(messages.getByRole('heading')).toHaveText('Mensajes· 3')
  await expectNoPageOverflow(page)

  // El contacto dice por qué está ahí, aunque su último mensaje hable de otra cosa.
  await expect(contacts.getByText('Servicio: Limpieza Facial')).toBeVisible()

  // Un resultado por mensaje: el chat de @paoocx.r sale dos veces, y lo que
  // mandó el negocio lleva su marca.
  const rows = messages.getByRole('button')
  await expect(rows).toHaveCount(3)
  await expect(rows.filter({ hasText: '@paoocx.r' })).toHaveCount(2)
  await expect(messages.getByRole('img', { name: 'Enviado por el negocio' })).toHaveCount(2)
  // Lo buscado va resaltado, también cuando el mensaje lo dice en plural.
  await expect(rows.nth(2).locator('mark')).toHaveText(['limpieza', 'facial'])
  await expectFullyOnScreen(rows.nth(2))

  // La lista de contactos no pidió también los mensajes: eso es de la otra sección.
  expect(searchedIn.at(-1)).toBe('contacts')

  await rows.first().click()
  await expect(page).toHaveURL(new RegExp(`/chat/${PAOLA}$`))
  if (!isMobile) await expect(rows.first()).toBeVisible()
})
