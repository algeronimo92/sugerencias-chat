import { test as base, expect } from '@playwright/test'
import { MockApi } from './api'
import { crmDefaults } from './crm'

export const test = base.extend<{ api: MockApi }>({
  api: [async ({ page }, use) => {
    const api = new MockApi()
    crmDefaults(api)
    await api.install(page)
    await use(api)
    expect(api.unhandled, 'pedidos al backend sin respuesta simulada (agregarlos en e2e/fixtures)').toEqual([])
  }, { auto: true }],
})

export { expect }
