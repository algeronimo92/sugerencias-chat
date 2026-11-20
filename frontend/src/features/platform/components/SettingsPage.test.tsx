import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { expect, it } from 'vitest'
import { installFakeApi } from '../../../test/fakeApi'
import { createTestQueryClient, queryWrapper } from '../../../test/queryWrapper'
import { SettingsPage } from './SettingsPage'

const api = installFakeApi()

function renderAt(path: string) {
  return render(
    <Routes>
      <Route path="/configuracion" element={<SettingsPage />} />
      <Route path="/configuracion/:section" element={<SettingsPage />} />
    </Routes>,
    { wrapper: queryWrapper(createTestQueryClient(), { route: path }) },
  )
}

it('es una página con su título y una sección por URL', async () => {
  api.current.on('get', '/api/settings', { data: [] })
  renderAt('/configuracion')

  expect(screen.getByRole('heading', { level: 1, name: 'Configuración' })).toBeInTheDocument()
  const nav = screen.getByRole('navigation', { name: 'Secciones de configuración' })
  expect(within(nav).getByRole('link', { name: 'General' })).toHaveAttribute('aria-current', 'page')
  expect(within(nav).getByRole('link', { name: 'Usuarios' })).toHaveAttribute('href', '/configuracion/usuarios')
  expect(screen.getByRole('link', { name: 'Integraciones' })).toHaveAttribute('href', '/integraciones')
})

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
  renderAt('/configuracion')
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
