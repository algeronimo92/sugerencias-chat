import { ADMIN, chat } from '../../fixtures/crm'
import { expect, test } from '../../fixtures/test'

for (const restricted of [false, true]) {
  test(`vendedor: Todas respeta el ajuste ${restricted ? 'activado' : 'desactivado'} y permite volver desde Mías`, async ({ page, api, isMobile }) => {
    const seller = { ...ADMIN, id: 2, role: 'vendedor' as const, name: 'Ana' }
    const own = chat({ chat_id: '51999000101', name: 'Cliente de Ana', vendedor_id: 2, vendedor: 'Ana' })
    const foreign = chat({ chat_id: '51999000102', name: 'Cliente de Bea', vendedor_id: 3, vendedor: 'Bea' })
    const unassigned = chat({ chat_id: '51999000103', name: 'Cliente sin asignar', vendedor_id: null, vendedor: null })
    const permitted = restricted ? [own] : [own, foreign, unassigned]
    const requestedSellers: (string | null)[] = []
    api.on('get', '/api/auth/me', seller)
      .on('get', '/api/chats', ({ url }) => {
        const sellerId = url.searchParams.get('seller_id')
        requestedSellers.push(sellerId)
        const items = sellerId ? permitted.filter(lead => String(lead.vendedor_id) === sellerId) : permitted
        return { items, has_more: false, total: items.length }
      })
      .on('get', '/api/chats/counts', {
        all: permitted.length, mine: 1, unassigned: restricted ? 0 : 1,
        unread: 0, open: permitted.length, closed: 0, waiting: 0, stages: { nuevo: permitted.length },
      })

    await page.goto('/')
    await expect(page.getByText(own.name!, { exact: true })).toBeVisible()
    expect(requestedSellers.at(-1)).toBeNull()
    if (restricted) {
      await expect(page.getByText(foreign.name!, { exact: true })).toHaveCount(0)
      await expect(page.getByText(unassigned.name!, { exact: true })).toHaveCount(0)
    } else {
      await expect(page.getByText(foreign.name!, { exact: true })).toBeVisible()
      await expect(page.getByText(unassigned.name!, { exact: true })).toBeVisible()
    }

    if (isMobile) await page.getByRole('button', { name: /Cambiar de bandeja/ }).click()
    await page.getByRole('button', { name: /^Mías/ }).click()
    if (isMobile) await page.getByRole('button', { name: 'Ver conversaciones' }).click()
    await expect.poll(() => requestedSellers.at(-1)).toBe('2')
    await expect(page.getByText(foreign.name!, { exact: true })).toHaveCount(0)

    if (isMobile) await page.getByRole('button', { name: /Cambiar de bandeja/ }).click()
    const allInbox = page.getByRole('button', { name: /^Todas/ })
    await allInbox.click()
    await expect(allInbox).toHaveAttribute('aria-pressed', 'true')
    if (isMobile) await page.getByRole('button', { name: 'Ver conversaciones' }).click()
    // La lista de Todas puede seguir fresca en caché: debe restaurarse sin
    // exigir otro request para los datos que el servidor ya autorizó.
    await expect(page.getByText(own.name!, { exact: true })).toBeVisible()
    if (!restricted) await expect(page.getByText(foreign.name!, { exact: true })).toBeVisible()
  })
}
