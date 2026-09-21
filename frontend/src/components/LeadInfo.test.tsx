import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { Chat } from '../types'
import { LeadInfo } from './LeadInfo'

vi.mock('../hooks/useChats', () => ({
  useUpdateLead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkNoShow: () => ({ mutate: vi.fn(), isPending: false }),
}))

describe('LeadInfo', () => {
  it('muestra el username de Meta cuando existe', () => {
    const chat = {
      chat_id: 'af36fbfb-870b-4d02-b67e-4bf1fa17f97e',
      username: '@gporta.21',
      name: 'Gerson Portal',
      phone: '51911111111',
      secondary_phone: null,
      stage: 'nuevo',
      conversacion_abierta: true,
      tags: [],
    } as unknown as Chat

    render(<MemoryRouter><LeadInfo chat={chat} /></MemoryRouter>)

    expect(screen.getByText('Username')).toBeInTheDocument()
    expect(screen.getByText('@gporta.21')).toBeInTheDocument()
  })
})
