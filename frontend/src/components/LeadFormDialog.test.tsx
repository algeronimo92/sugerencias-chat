import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { LeadFormDialog } from './LeadFormDialog'

const mocks = vi.hoisted(() => ({ createService: vi.fn() }))

vi.mock('../hooks/useAuth', () => ({
  useMe: () => ({ data: { id: 7, role: 'vendedor', name: 'Gerson' } }),
}))
vi.mock('../hooks/useUsers', () => ({ useSellers: () => ({ data: [] }) }))
vi.mock('../hooks/useChats', () => ({
  useDuplicateLead: () => ({ data: null, isFetching: false }),
  usePhoneConfig: () => ({ data: { default_country_code: '51' } }),
}))
vi.mock('../hooks/useLeadServices', () => ({
  useLeadServices: () => ({
    data: [
      { id: 1, name: 'Botox' },
      { id: 2, name: 'Limpieza facial' },
    ],
    isLoading: false,
  }),
  useCreateLeadService: () => ({ mutate: mocks.createService, isPending: false }),
}))

function renderDialog(onSubmit = vi.fn()) {
  render(
    <LeadFormDialog
      title="Editar lead"
      submitLabel="Guardar"
      initial={{ name: 'Ana', servicio_interes: 'Botox' }}
      canEditPhone={false}
      isSubmitting={false}
      onSubmit={onSubmit}
      onCancel={vi.fn()}
    />,
  )
  return onSubmit
}

describe('LeadFormDialog service catalog', () => {
  beforeEach(() => {
    mocks.createService.mockReset()
  })

  it('permite elegir un servicio consistente desde el catálogo', async () => {
    const user = userEvent.setup()
    const onSubmit = renderDialog()

    await user.click(screen.getByLabelText('Servicio de interés'))
    await user.click(screen.getByRole('option', { name: 'Limpieza facial' }))
    await user.click(screen.getByRole('button', { name: 'Guardar' }))

    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      servicio_interes: 'Limpieza facial',
    }))
  })

  it('permite crear un nuevo servicio desde el formulario', async () => {
    const user = userEvent.setup()
    const onSubmit = renderDialog()

    await user.click(screen.getByRole('button', { name: 'Crear servicio' }))
    await user.type(screen.getByPlaceholderText('Nombre del nuevo servicio'), 'Hollywood Peel')
    await user.click(screen.getByRole('button', { name: 'Crear' }))
    expect(mocks.createService).toHaveBeenCalledWith('Hollywood Peel', expect.any(Object))
    expect(onSubmit).not.toHaveBeenCalled()
  })
})
