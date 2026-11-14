import { expectFullyOnScreen, expectNoPageOverflow } from '../../fixtures/screen'
import { expect, test } from '../../fixtures/test'

test('desde la lista se abre un chat y se puede escribir', async ({ page, isMobile }) => {
  await page.goto('/')
  await expectNoPageOverflow(page)

  await page.getByText('Josefina Paredes').first().click()
  await expect(page).toHaveURL(/\/chat\/51999000111$/)
  await expectFullyOnScreen(page.getByLabel('Escribe un mensaje', { exact: true }))

  // En el celular el chat ocupa toda la pantalla: la única salida es la flecha.
  if (isMobile) {
    const main = page.getByRole('navigation', { name: 'Vista principal' })
    await expect(main).toBeHidden()
    await page.getByRole('button', { name: 'Volver a la lista de chats' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expectFullyOnScreen(main)
  }
})
