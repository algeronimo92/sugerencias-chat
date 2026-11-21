import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router-dom'
import { beforeEach, expect, it } from 'vitest'
import { installFakeApi } from '../../../test/fakeApi'
import { createTestQueryClient, queryWrapper } from '../../../test/queryWrapper'
import { SettingsPage } from './SettingsPage'

const api = installFakeApi()

const PERMISSIONS = [
  { key: 'dashboard.view', group: 'dashboard', label: 'Ver el dashboard del equipo', admin_only: false },
  { key: 'leads.delete', group: 'leads', label: 'Eliminar leads', admin_only: false },
  { key: 'users.manage', group: 'settings', label: 'Gestionar usuarios y permisos de los roles', admin_only: true },
]

function roles(seller: string[]) {
  return {
    roles: [
      { key: 'admin', name: 'Administrador', editable: false, permissions: PERMISSIONS.map((p) => p.key), active_users: 1 },
      { key: 'vendedor', name: 'Vendedor', editable: true, permissions: seller, active_users: 3 },
      { key: 'analista', name: 'Analista', editable: true, permissions: ['dashboard.view'], active_users: 0 },
    ],
    permissions: PERMISSIONS,
  }
}

function renderAt(path: string, me: Record<string, unknown> = { role: 'admin', permissions: [] }) {
  api.current.on('get', '/api/auth/me', { data: { id: 1, email: 'a@clinica.test', name: 'Ana', can_handle_calls: false, ...me } })
  return render(
    <Routes>
      <Route path="/configuracion" element={<SettingsPage />} />
      <Route path="/configuracion/:section" element={<SettingsPage />} />
    </Routes>,
    { wrapper: queryWrapper(createTestQueryClient(), { route: path }) },
  )
}

beforeEach(() => {
  api.current.on('get', '/api/settings', { data: [] })
})

it('el admin queda fijo con todo y lo exclusivo del admin no se puede dar a otro rol', async () => {
  api.current.on('get', '/api/roles', { data: roles([]) })
  renderAt('/configuracion/roles')

  const adminDelete = await screen.findByRole('checkbox', { name: 'Eliminar leads: Administrador' })
  expect(adminDelete).toBeChecked()
  expect(adminDelete).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: 'Gestionar usuarios y permisos de los roles: Vendedor' })).toBeDisabled()
  expect(screen.getByRole('checkbox', { name: 'Eliminar leads: Vendedor' })).toBeEnabled()
  expect(screen.getAllByText('3 personas').length).toBeGreaterThan(0)
})

it('guarda solo la fila del rol que cambió', async () => {
  let saved: { role: string; permissions: string[] } | null = null
  api.current.on('get', '/api/roles', { data: roles([]) })
  api.current.on('put', /\/api\/roles\/[a-z]+\/permissions/, (request) => {
    const role = request.path.split('/')[3]
    saved = { role, permissions: (request.body as { permissions: string[] }).permissions }
    return { data: roles(saved.permissions) }
  })
  const user = userEvent.setup()
  renderAt('/configuracion/roles')

  const checkbox = await screen.findByRole('checkbox', { name: 'Eliminar leads: Vendedor' })
  const save = screen.getByRole('button', { name: 'Guardar' })
  expect(save).toBeDisabled()
  await user.click(checkbox)
  expect(screen.getByText('Cambios sin guardar en Vendedor')).toBeInTheDocument()
  await user.click(save)

  await waitFor(() => expect(saved).toEqual({ role: 'vendedor', permissions: ['leads.delete'] }))
  expect(await screen.findByText('Guardado')).toBeInTheDocument()
})

it('muestra los privilegios que la base tiene aplicados', async () => {
  api.current.on('get', '/api/roles/db-privileges', {
    data: {
      enforcement_active: false,
      can_create_roles: true,
      roles: [{
        db_role: `cv_${'a'.repeat(32)}_analista`,
        system: { superuser: false, create_db: false, create_role: false, login: false, bypass_rls: false, schema_usage: true, schema_create: false },
        objects: [{ object: 'leads', privileges: ['SELECT'] }, { object: 'users.password_hash', privileges: ['UPDATE'] }],
      }],
    },
  })
  const user = userEvent.setup()
  renderAt('/configuracion/base')

  const card = (await screen.findByRole('heading', { name: 'Analista' })).closest('section') as HTMLElement
  expect(within(card).getByText('2 objetos con acceso · 1 con escritura')).toBeInTheDocument()
  expect(screen.getByText(/DB_ROLE_ENFORCEMENT apagado/)).toBeInTheDocument()
  await user.click(within(card).getByText('Privilegios de objeto (tablas)'))
  expect(within(card).getByText('(solo esa columna)')).toBeInTheDocument()
})

it('quien no gestiona usuarios no ve las secciones de permisos', async () => {
  renderAt('/configuracion/roles', { role: 'vendedor', permissions: ['settings.manage'] })
  expect(await screen.findByRole('link', { name: 'General' })).toBeInTheDocument()
  expect(screen.queryByRole('link', { name: 'Roles y permisos' })).not.toBeInTheDocument()
})

it('sin roles, dice si falta el permiso CREATEROLE o solo el próximo despliegue', async () => {
  api.current.on('get', '/api/roles/db-privileges', { data: { enforcement_active: false, can_create_roles: false, roles: [] } })
  renderAt('/configuracion/base')
  expect(await screen.findByText(/no tiene\s+permiso para crear roles/)).toBeInTheDocument()
  // Sin roles no hay privilegios aplicados que anunciar.
  expect(screen.queryByText(/Los privilegios están aplicados/)).not.toBeInTheDocument()
})

it('sin roles pero con permiso, se crean en el próximo despliegue', async () => {
  api.current.on('get', '/api/roles/db-privileges', { data: { enforcement_active: false, can_create_roles: true, roles: [] } })
  renderAt('/configuracion/base')
  expect(await screen.findByText(/Se crean solos en el próximo despliegue/)).toBeInTheDocument()
})
