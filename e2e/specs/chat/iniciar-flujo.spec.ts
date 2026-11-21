import { CHAT_ID, FLOWS, execution } from '../../fixtures/crm'
import { expectFullyOnScreen } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

test('el menú "Iniciar flujo" muestra los nombres completos y lanza el flujo elegido al confirmarlo', async ({ page, api }) => {
  const chosen = FLOWS[1]
  api.on('post', '/api/automations/{rule_id}/start', execution(chosen))

  await page.goto(`/chat/${CHAT_ID}`)
  await page.getByRole('button', { name: 'Iniciar un flujo para este lead' }).click()

  // En el celular el menú se salía por la izquierda y se leía "videncia HP
  // hombre": cada opción tiene que entrar entera en la pantalla.
  for (const flow of FLOWS) {
    await expectFullyOnScreen(page.getByRole('button', { name: flow.name, exact: true }))
  }

  await page.getByRole('button', { name: chosen.name, exact: true }).click()

  // Elegir no lanza nada: un flujo le escribe al cliente, así que primero se
  // confirma en la franja de arriba del cuadro de escritura, entera en pantalla.
  const confirmation = page.getByRole('group', { name: `Confirmar el flujo ${chosen.name}` })
  await expectFullyOnScreen(confirmation)
  expect(api.calls('post', '/api/automations/{rule_id}/start')).toEqual([])
  await confirmation.getByRole('button', { name: 'Iniciar' }).click()

  expect(api.calls('post', '/api/automations/{rule_id}/start')).toEqual([
    { method: 'post', path: `/api/automations/${chosen.id}/start`, body: { chat_id: CHAT_ID } },
  ])
  await expect(page.getByText(`Flujo "${chosen.name}" iniciado`)).toBeVisible()
})

test('cancelar la confirmación no lanza el flujo', async ({ page, api }) => {
  const chosen = FLOWS[0]

  await page.goto(`/chat/${CHAT_ID}`)
  await page.getByRole('button', { name: 'Iniciar un flujo para este lead' }).click()
  await page.getByRole('button', { name: chosen.name, exact: true }).click()
  await page.getByRole('group', { name: `Confirmar el flujo ${chosen.name}` }).getByRole('button', { name: 'Cancelar' }).click()

  await expect(page.getByRole('group', { name: `Confirmar el flujo ${chosen.name}` })).toBeHidden()
  expect(api.calls('post', '/api/automations/{rule_id}/start')).toEqual([])
})
