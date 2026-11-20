import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { installFakeApi } from '../../../test/fakeApi'
import { createTestQueryClient, queryWrapper } from '../../../test/queryWrapper'
import { SettingsDialog } from './SettingsDialog'

const api = installFakeApi()

it('permite activar, guardar y desactivar que cada vendedor vea solo sus leads', async () => {
  const key = 'sellers_see_only_assigned_leads'
  const label = 'Cada vendedor ve solo los leads asignados a él (los administradores ven todos)'
  let stored = ''
  const items = () => [{ key, label, group: 'leads', group_label: 'Leads (CRM)', secret: false,
    boolean: true, configured: Boolean(stored), value: stored }]
  api.current.on('get', '/api/settings', () => ({ data: items() }))
  api.current.on('put', '/api/settings', request => {
    stored = (request.body as { values: Record<string, string> }).values[key]
    return { data: items() }
  })
  const user = userEvent.setup()
  render(<SettingsDialog onClose={vi.fn()} />, { wrapper: queryWrapper(createTestQueryClient()) })
  const checkbox = await screen.findByRole('checkbox', { name: label })
  expect(checkbox).not.toBeChecked()
  await user.click(checkbox)
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(stored).toBe('true'))
  expect(checkbox).toBeChecked()
  await user.click(checkbox)
  await user.click(screen.getByRole('button', { name: 'Guardar' }))
  await waitFor(() => expect(stored).toBe('false'))
  expect(checkbox).not.toBeChecked()
})
