import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { installFakeApi } from '../../../../../test/fakeApi'
import { createTestQueryClient, queryWrapper } from '../../../../../test/queryWrapper'
import type { Organization } from '../../../types'
import { BusinessDatabase } from './BusinessDatabase'

const api = installFakeApi()

const NEGOCIO = { id: 'org-1', name: 'Clínica Norte', schema_name: 'tenant_' + 'a'.repeat(32) } as Organization
const RUTA = '/api/platform/organizations/org-1/db-access'
const CREDENCIALES = { user: 'norte', password: 'clave-nueva-123', database: 'cliniventas_db', schema: NEGOCIO.schema_name }

function renderDatabase() {
  return render(<BusinessDatabase organizacion={NEGOCIO} />, { wrapper: queryWrapper(createTestQueryClient()) })
}

it('sin login, lo crea y muestra la contraseña una sola vez', async () => {
  let reseteos = 0
  api.current.on('get', RUTA, { data: { user: null, database: 'cliniventas_db', schema: NEGOCIO.schema_name } })
  api.current.on('post', `${RUTA}/reset`, () => { reseteos += 1; return { data: CREDENCIALES } })
  const user = userEvent.setup()
  renderDatabase()

  expect(await screen.findByText('Sin crear')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Crear acceso' }))

  expect(await screen.findByText('clave-nueva-123')).toBeInTheDocument()
  expect(screen.getByText(/no se vuelve a mostrar/)).toBeInTheDocument()
  expect(reseteos).toBe(1)
})

it('con login, regenerar la contraseña pide confirmación', async () => {
  let reseteos = 0
  api.current.on('get', RUTA, { data: { user: 'norte', database: 'cliniventas_db', schema: NEGOCIO.schema_name } })
  api.current.on('post', `${RUTA}/reset`, () => { reseteos += 1; return { data: CREDENCIALES } })
  const user = userEvent.setup()
  renderDatabase()

  await user.click(await screen.findByRole('button', { name: 'Generar contraseña nueva' }))
  expect(reseteos).toBe(0)
  expect(screen.getByText(/deja de funcionar en el momento/)).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: 'Generar contraseña' }))

  expect(await screen.findByText('clave-nueva-123')).toBeInTheDocument()
  expect(reseteos).toBe(1)
})
