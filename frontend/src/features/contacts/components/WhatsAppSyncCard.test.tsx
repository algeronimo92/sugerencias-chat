import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { WhatsAppSyncCard } from './WhatsAppSyncCard'

type Sync = {
  phone_number_id: string
  sync_type: 'smb_app_state_sync' | 'history'
  status: 'requested' | 'receiving' | 'done' | 'failed' | 'declined'
  error: string | null
  progress: number | null
  can_retry: boolean
  window_ends_at: string | null
}

const mocks = vi.hoisted(() => ({
  status: null as { auto_import: boolean; open_batch_id: string | null; syncs: Sync[] } | null,
  pending: 0,
}))

vi.mock('../hooks/useContacts', () => ({
  useWhatsAppSync: () => ({ data: mocks.status }),
  useImportSummary: () => ({ data: mocks.status?.open_batch_id ? { counts: { pending: mocks.pending } } : undefined }),
  useSetWhatsAppAutoImport: () => ({ mutate: vi.fn(), isPending: false }),
  useRetryWhatsAppSync: () => ({ mutate: vi.fn(), isPending: false }),
}))

const CONTACTS: Sync = {
  phone_number_id: 'PN', sync_type: 'smb_app_state_sync', status: 'done',
  error: null, progress: null, can_retry: false, window_ends_at: null,
}

describe('WhatsAppSyncCard', () => {
  it('número solo en el CRM: no se muestra', () => {
    mocks.status = { auto_import: false, open_batch_id: null, syncs: [] }
    const { container } = render(<WhatsAppSyncCard onReview={() => {}} />)

    expect(container).toBeEmptyDOMElement()
  })

  it('número en la app del celular: muestra lo que llegó', () => {
    mocks.status = { auto_import: false, open_batch_id: null, syncs: [CONTACTS] }
    render(<WhatsAppSyncCard onReview={() => {}} />)

    expect(screen.getByText('Los cambios de la agenda del celular llegan solos.')).toBeInTheDocument()
  })

  it('contactos del celular esperando: se muestra aunque el número ya no tenga pedidos', () => {
    mocks.status = { auto_import: false, open_batch_id: 'b1', syncs: [] }
    mocks.pending = 3
    render(<WhatsAppSyncCard onReview={() => {}} />)

    expect(screen.getByRole('button', { name: 'Elegir cuáles importar' })).toBeInTheDocument()
  })
})
