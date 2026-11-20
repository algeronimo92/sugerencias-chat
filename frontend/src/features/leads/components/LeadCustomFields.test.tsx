import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LeadCustomFields } from './LeadCustomFields'

const mutate = vi.fn((_draft: unknown, options: { onError: (err: unknown) => void }) => options.onError(new Error('El campo Zona es obligatorio')))

vi.mock('../../catalogs/public/useCustomFields', () => ({
  useCustomFields: () => ({ data: [{ id: 1, key: 'zona', label: 'Zona', required: true, field_type: 'text' }] }),
}))
vi.mock('../../catalogs/public/CustomFieldInput', () => ({ CustomFieldInput: () => <input aria-label="Zona" /> }))
vi.mock('../hooks/useLeadCustomFieldValues', () => ({
  useLeadCustomFieldValues: () => ({ data: { zona: 'Miraflores' } }),
  useUpdateLeadCustomFieldValues: () => ({ mutate, isPending: false }),
}))

describe('LeadCustomFields', () => {
  it('muestra los valores y el error al guardar en la misma sección', async () => {
    const user = userEvent.setup()
    render(<LeadCustomFields chatId="lead-1" />)

    expect(screen.getByText('Miraflores')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Editar' }))
    await user.click(screen.getByRole('button', { name: 'Guardar campos' }))

    expect(screen.getByRole('alert')).toHaveTextContent('El campo Zona es obligatorio')
  })
})
