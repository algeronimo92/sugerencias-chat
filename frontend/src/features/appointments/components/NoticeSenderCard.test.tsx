import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NoticeSender } from '../types'
import { NoticeSenderCard } from './NoticeSenderCard'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() }))

vi.mock('../../../shared/http/client', () => ({ default: api }))

// El SDK de Facebook no corre en los tests: se simula el hook y se dispara a
// mano el final del registro de Meta.
const signup = vi.hoisted(() => ({
  configured: false,
  onComplete: null as null | ((payload: { code: string; waba_id: string; phone_number_id?: string }) => void),
  start: vi.fn(),
}))
vi.mock('../../platform/public/useMetaEmbeddedSignup', () => ({
  useMetaEmbeddedSignup: (onComplete: typeof signup.onComplete) => {
    signup.onComplete = onComplete
    return {
      loading: false, configured: signup.configured, ready: true,
      start: signup.start, error: null, setError: vi.fn(),
    }
  },
}))

const CRM = { id: 'CRM_ID', display_phone_number: '+51 900 000 000', verified_name: 'Clínica', is_crm: true, waba_id: 'WABA_ID' }
const AVISOS = { id: 'AVISOS_ID', display_phone_number: '+51 900 000 999', verified_name: 'Clínica avisos', is_crm: false, waba_id: 'WABA_ID' }

function renderCard(partial: Pick<NoticeSender, 'phone_number_id' | 'numbers'> & Partial<NoticeSender>) {
  const data: NoticeSender = { account: null, templates: [], ...partial }
  api.get.mockResolvedValue({ data })
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <NoticeSenderCard />
    </QueryClientProvider>,
  )
}

describe('NoticeSenderCard', () => {
  beforeEach(() => {
    api.get.mockReset()
    api.put.mockReset()
    api.post.mockReset()
    signup.configured = false
    signup.onComplete = null
    signup.start.mockReset()
  })

  it('ofrece solo los otros números de la cuenta y guarda el elegido', async () => {
    const user = userEvent.setup()
    api.put.mockResolvedValue({ data: { phone_number_id: 'AVISOS_ID', numbers: [CRM, AVISOS] } })
    renderCard({ phone_number_id: null, numbers: [CRM, AVISOS] })

    await user.click(await screen.findByRole('combobox'))
    const options = (await screen.findAllByRole('option')).map(option => option.textContent)
    expect(options).toEqual(['El número del CRM (el de los chats)', '+51 900 000 999 · Clínica avisos'])

    await user.click(screen.getByRole('option', { name: '+51 900 000 999 · Clínica avisos' }))
    await user.click(screen.getByRole('button', { name: 'Guardar número' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith(
      '/api/appointments/notice-sender', { phone_number_id: 'AVISOS_ID' },
    ))
  })

  it('explica cómo agregar otro número cuando la cuenta tiene uno solo', async () => {
    renderCard({ phone_number_id: null, numbers: [CRM] })

    expect(await screen.findByText(/salen del número del CRM/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Guardar número' })).not.toBeInTheDocument()
  })

  it('muestra el número elegido en el estado de la tarjeta', async () => {
    renderCard({ phone_number_id: 'AVISOS_ID', numbers: [CRM, AVISOS] })

    // En el estado de la tarjeta y como valor del selector.
    expect(await screen.findAllByText('+51 900 000 999 · Clínica avisos')).toHaveLength(2)
  })

  it('vincula con Meta un número en coexistencia como número de avisos', async () => {
    const user = userEvent.setup()
    signup.configured = true
    api.post.mockResolvedValue({ data: { phone_number_id: 'AVISOS_ID', numbers: [CRM, AVISOS] } })
    renderCard({ phone_number_id: null, numbers: [CRM] })

    await user.click(await screen.findByRole('button', { name: 'Vincular número de avisos con Meta' }))
    expect(signup.start).toHaveBeenCalled()

    signup.onComplete?.({ code: 'CODE', waba_id: 'WABA_ID' })

    await waitFor(() => expect(api.post).toHaveBeenCalledWith(
      '/api/appointments/notice-sender/embedded-signup', { code: 'CODE', waba_id: 'WABA_ID' },
    ))
  })

  it('con su propia cuenta muestra las copias de las plantillas y pide copiar las que faltan', async () => {
    const user = userEvent.setup()
    const own = { ...AVISOS, waba_id: 'WABA_AVISOS' }
    const account = { waba_id: 'WABA_AVISOS', name: 'DérmicaPRO' }
    renderCard({
      phone_number_id: 'AVISOS_ID', numbers: [CRM, own], account,
      templates: [
        { audience: 'client', template_id: 7, name: 'confirmacion_cita', status: 'APPROVED' },
        { audience: 'staff', template_id: 12, name: 'nueva_venta', status: 'MISSING' },
      ],
    })
    api.post.mockResolvedValue({ data: {
      phone_number_id: 'AVISOS_ID', numbers: [CRM, own], account,
      templates: [
        { audience: 'client', template_id: 7, name: 'confirmacion_cita', status: 'APPROVED' },
        { audience: 'staff', template_id: 12, name: 'nueva_venta', status: 'PENDING' },
      ],
    } })

    expect(await screen.findByText('Plantillas en DérmicaPRO')).toBeInTheDocument()
    expect(screen.getByText('Aprobada')).toBeInTheDocument()
    expect(screen.getByText('Sin copiar')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Copiar plantillas' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/appointments/notice-sender/templates'))
  })
})
