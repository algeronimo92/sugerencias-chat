import { CHAT_ID } from '../../fixtures/crm'
import { expectFullyOnScreen } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

test('"Separar cita" abre el formulario del lead con el botón de confirmar a la vista', async ({ page }) => {
  await page.goto(`/chat/${CHAT_ID}`)
  await page.getByRole('button', { name: 'Separar cita para este lead' }).click()

  const form = page.getByRole('dialog')
  await expect(form.getByText('Josefina Paredes')).toBeVisible()
  // El tratamiento llega prellenado con el interés del lead.
  await expect(form.getByRole('combobox', { name: /Tratamiento/ })).toHaveValue('HIFU 12D')

  // Separar la cita es la venta: el botón que la confirma y el de cerrar no
  // pueden quedar fuera de la pantalla, por largo que sea el formulario.
  await expectFullyOnScreen(form.getByRole('button', { name: 'Separar cita' }))
  await expectFullyOnScreen(form.getByRole('button', { name: 'Cerrar' }))

  await form.getByRole('button', { name: 'Cerrar' }).click()
  await expect(form).toBeHidden()
  await expectFullyOnScreen(page.getByLabel('Escribe un mensaje', { exact: true }))
})
