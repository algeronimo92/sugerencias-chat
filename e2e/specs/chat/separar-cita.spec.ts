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

test('con el envío de citas al ERP, lo que se pide de más no saca de la pantalla el botón de confirmar', async ({ page, api }) => {
  api
    .on('get', '/api/appointments/erp-sync', {
      active: true, enabled: true, url: 'https://erp.example', token_configured: true, catalog_connected: true,
    })
    .on('get', '/api/services', [
      {
        id: 1, name: 'HIFU 12D', is_active: true, external_id: 'svc-1', created_by_user_id: null, created_by_name: null, created_at: null,
        packages: [
          { id: 11, service_id: 1, name: 'x3', sessions: 3, price: '400.00', notes: null, position: 1, is_active: true, external_id: 'pk-3' },
          { id: 10, service_id: 1, name: 'Individual', sessions: 1, price: '150.00', notes: null, position: 0, is_active: true, external_id: 'pk-1' },
        ],
      },
    ])

  await page.goto(`/chat/${CHAT_ID}`)
  await page.getByRole('button', { name: 'Separar cita para este lead' }).click()

  const form = page.getByRole('dialog')
  // El paquete llega elegido (el de menos sesiones) y se pide el DNI.
  await expect(form.getByLabel(/^Paquete/)).toBeVisible()
  await expect(form.getByText('Individual · 1 sesión · S/ 150.00').first()).toBeVisible()
  await expect(form.getByLabel(/^DNI/)).toBeVisible()

  await expectFullyOnScreen(form.getByRole('button', { name: 'Separar cita' }))
  await expectFullyOnScreen(form.getByRole('button', { name: 'Cerrar' }))
})

