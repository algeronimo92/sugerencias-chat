import { CHAT_ID, FLOWS, execution } from '../../fixtures/crm'
import { expectFullyOnScreen } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

test('el menú "Iniciar flujo" muestra los nombres completos y lanza el flujo elegido', async ({ page, api }) => {
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

  expect(api.calls('post', '/api/automations/{rule_id}/start')).toEqual([
    { method: 'post', path: `/api/automations/${chosen.id}/start`, body: { chat_id: CHAT_ID } },
  ])
  await expect(page.getByText(`Flujo "${chosen.name}" iniciado`)).toBeVisible()
})
