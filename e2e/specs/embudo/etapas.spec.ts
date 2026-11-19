import { chat } from '../../fixtures/crm'
import { expectNoPageOverflow } from '../../fixtures/screen'
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
  await page.goto('/kanban')
  await expect(page.getByRole('heading', { name: 'Embudo comercial' })).toBeVisible()

  // Arranca en la primera etapa con leads, sin columnas cortadas a los lados.
  const lista = page.getByRole('list', { name: 'Leads en Nuevo' })
  await expect(lista.getByRole('listitem')).toHaveCount(6)
  await expectNoPageOverflow(page)
  await page.screenshot({ path: `test-results/embudo-${info.project.name}.png` })

  await page.getByRole('navigation', { name: 'Etapas del embudo' }).locator('visible=true')
    .getByRole('button', { name: /^Agendado, 4 leads/ }).click()
  await expect(page.getByRole('list', { name: 'Leads en Agendado' }).getByRole('listitem')).toHaveCount(4)
  // La etapa queda en la URL para volver a ella después de abrir un chat.
  await expect(page).toHaveURL(/etapa=agendado/)
  await page.screenshot({ path: `test-results/embudo-agendado-${info.project.name}.png` })
})
