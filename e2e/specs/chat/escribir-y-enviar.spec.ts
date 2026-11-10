import { CHAT_ID, message, sentMessage } from '../../fixtures/crm'
import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

test.describe('escribir en un chat', () => {
  test('el cuadro de escritura se ve entero y el mensaje enviado aparece en la conversación', async ({ page, api }) => {
    const messages = [message()]
    api
      .on('get', '/api/chats/{chat_id}/messages', () => ({ items: messages, has_more: false }))
      .on('post', '/api/chats/{chat_id}/messages', ({ body }) => {
        const sent = sentMessage((body as { text: string }).text, { sent_at: new Date().toISOString() })
        messages.push(sent)
        return sent
      })

    await page.goto(`/chat/${CHAT_ID}`)

    // El cuadro quedó una vez debajo de la barra del sistema: existía, pero
    // fuera del área visible. Por eso se afirma la posición y no solo que esté.
    const box = page.getByPlaceholder('Escribe un mensaje...')
    await expectFullyOnScreen(box)
    await expectNoPageOverflow(page)

    await box.fill('Claro, te paso los precios')
    const send = page.getByRole('button', { name: 'Enviar mensaje' })
    await expectFullyOnScreen(send)
    await send.click()

    expect(api.calls('post', '/api/chats/{chat_id}/messages').map(call => call.body)).toEqual([
      { text: 'Claro, te paso los precios', reply_to_message_id: null },
    ])
    await expect(page.getByText('Claro, te paso los precios')).toBeVisible()
    await expect(box).toHaveValue('')
  })

  test('la cabecera del chat entra en la pantalla con todas sus acciones', async ({ page }) => {
    await page.goto(`/chat/${CHAT_ID}`)

    await expect(page.getByText('Josefina Paredes').last()).toBeVisible()
    await expectFullyOnScreen(page.getByRole('button', { name: 'Iniciar un flujo para este lead' }))
    await expectFullyOnScreen(page.getByRole('button', { name: 'Separar cita para este lead' }))
    await expectNoPageOverflow(page)
  })
})
