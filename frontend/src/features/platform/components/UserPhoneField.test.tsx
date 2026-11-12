import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppUser } from '../types'
import { UserPhoneField } from './UserPhoneField'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

const grecia: AppUser = {
  id: 5, email: 'grecia@example.com', name: 'Grecia', role: 'vendedor',
  is_active: true, invitation_pending: false, phone: null,
}

function renderField(user: AppUser) {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <UserPhoneField user={user} />
    </QueryClientProvider>,
  )
}

describe('UserPhoneField', () => {
  beforeEach(() => api.patch.mockReset())

  it('dice cuando el usuario no recibe avisos por WhatsApp', () => {
    renderField(grecia)
    expect(screen.getByText('Sin WhatsApp para avisos')).toBeInTheDocument()
  })

  it('guarda el WhatsApp del usuario', async () => {
    api.patch.mockResolvedValue({ data: { ...grecia, phone: '51927345336' } })
    renderField(grecia)

    await userEvent.click(screen.getByRole('button', { name: 'Cambiar el WhatsApp de Grecia' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'WhatsApp de Grecia' }), '927 345 336')
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    await waitFor(() => expect(api.patch).toHaveBeenCalledWith('/api/users/5', { phone: '927 345 336' }))
  })

  it('muestra el número guardado con su código de país', () => {
    renderField({ ...grecia, phone: '51927345336' })
    expect(screen.getByText('+51927345336')).toBeInTheDocument()
  })
})
