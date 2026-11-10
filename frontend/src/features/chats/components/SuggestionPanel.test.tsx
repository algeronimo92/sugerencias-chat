import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { SuggestionResponse } from '../../ai/types'
import type { Chat } from '../../leads/types'
import { SuggestionPanel } from './SuggestionPanel'

// La ficha del lead no es parte de lo que se prueba acá.
vi.mock('./ScheduledMessageCard', () => ({ ScheduledMessageCard: () => null }))
vi.mock('../../leads/public/LeadActivityPanel', () => ({ LeadActivityPanel: () => null }))
vi.mock('../../leads/public/LeadInfo', () => ({ LeadInfo: () => null }))
vi.mock('../../leads/public/LeadTagsPanel', () => ({ LeadTagsPanel: () => null }))
vi.mock('../../tasks/public/LeadTaskCard', () => ({ LeadTaskCard: () => null }))
vi.mock('../../ai/public/LeadAnalysisAction', () => ({ LeadAnalysisAction: () => null }))
vi.mock('../../appointments/public/LeadAppointmentAction', () => ({ LeadAppointmentAction: () => <button type="button">Separar cita</button> }))
// La ventana de 24 h la lee el panel para no ofrecer texto libre cuando no se puede enviar.
let serviceWindow: { is_open: boolean; last_customer_message_at: string | null } | undefined
vi.mock('../hooks/useCustomerServiceWindow', () => ({ useCustomerServiceWindow: () => ({ data: serviceWindow, isLoading: false }) }))

const chat = { chat_id: 'lead-1', phone: '51999' } as unknown as Chat
const savedByN8n: SuggestionResponse = {
  estado: null,
  tipo_objecion: null,
  analisis: 'Sugerencia vieja de n8n',
  confianza: 'alta',
  senal_compra: false,
  alerta: null,
  sugerencias: [],
}
const keyMissing = {
  code: 'ai_key_missing',
  message: 'Las sugerencias con IA no están conectadas: carga la clave de tu proveedor de IA en Integraciones.',
}

function renderPanel(props: Partial<React.ComponentProps<typeof SuggestionPanel>> = {}) {
  return render(
    <MemoryRouter>
      <SuggestionPanel
        chat={chat}
        data={null}
        generatedAt={null}
        isStale={false}
        isLoading={false}
        isGenerating={false}
        error={null}
        onGenerate={vi.fn()}
        {...props}
      />
    </MemoryRouter>,
  )
}

describe('SuggestionPanel sin IA conectada', () => {
  it('al admin le explica qué falta y lo lleva a Integraciones, sin mostrar la sugerencia vieja', () => {
    renderPanel({ data: savedByN8n, unavailable: keyMissing, canConnect: true })

    expect(screen.getByRole('status')).toHaveTextContent('no están conectadas')
    expect(screen.getByRole('link', { name: 'Conectar en Integraciones' })).toHaveAttribute('href', '/integraciones#ia-sugerencias')
    expect(screen.queryByText('Sugerencia vieja de n8n')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Genera/ })).not.toBeInTheDocument()
  })

  it('al vendedor le dice que lo pida a un administrador', () => {
    renderPanel({ unavailable: keyMissing, canConnect: false })

    expect(screen.queryByRole('link', { name: 'Conectar en Integraciones' })).not.toBeInTheDocument()
    expect(screen.getByText(/Pídele a un administrador/)).toBeInTheDocument()
  })

  it('un motivo que el negocio no resuelve solo no ofrece el enlace', () => {
    renderPanel({ unavailable: { code: 'ai_disabled', message: 'El asistente IA no está incluido en el plan.' }, canConnect: true })

    expect(screen.getByRole('status')).toHaveTextContent('no está incluido en el plan')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('si falla al generar por falta de clave, también ofrece el enlace', () => {
    renderPanel({ error: keyMissing.message, errorCode: 'ai_key_missing', errorRetryable: false, canConnect: true })

    expect(screen.getByRole('link', { name: 'Conectar en Integraciones' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument()
  })
})

describe('SuggestionPanel con la ventana de 24 h cerrada', () => {
  it('no ofrece generar y explica que solo salen plantillas', () => {
    serviceWindow = { is_open: false, last_customer_message_at: '2026-11-01T10:00:00Z' }
    renderPanel()

    expect(screen.getByRole('status')).toHaveTextContent('solo puedes enviar una plantilla aprobada')
    expect(screen.queryByRole('button', { name: /Genera/ })).not.toBeInTheDocument()
    serviceWindow = undefined
  })

  it('con sugerencias viejas las muestra pero no deja pedir nuevas', () => {
    serviceWindow = { is_open: false, last_customer_message_at: '2026-11-01T10:00:00Z' }
    renderPanel({ data: { ...savedByN8n, analisis: 'Quiere el pack' }, isStale: true })

    expect(screen.getByText('Quiere el pack')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Genera/ })).not.toBeInTheDocument()
    serviceWindow = undefined
  })

  it('con la ventana abierta sí se puede generar', () => {
    serviceWindow = { is_open: true, last_customer_message_at: '2026-11-09T10:00:00Z' }
    renderPanel()
    expect(screen.getByRole('button', { name: 'Genera sugerencias' })).toBeInTheDocument()
    serviceWindow = undefined
  })
})

describe('SuggestionPanel pestañas', () => {
  it('separa la ficha del copiloto y recuerda en el navegador la última pestaña', async () => {
    localStorage.removeItem('ficha-lead-pestana')
    localStorage.removeItem('copiloto-ia-plegado')
    const user = userEvent.setup()
    const { unmount } = renderPanel()

    // Sin preferencia guardada abre en el copiloto, como antes.
    expect(screen.getByRole('tab', { name: /Copiloto IA/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.queryByRole('button', { name: 'Separar cita' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /Ficha/ }))
    // La ficha abre con la acción que genera la venta.
    expect(screen.getByRole('button', { name: 'Separar cita' })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-lead-ficha')
    expect(localStorage.getItem('ficha-lead-pestana')).toBe('ficha')
    unmount()

    renderPanel()
    expect(screen.getByRole('tab', { name: /Ficha/ })).toHaveAttribute('aria-selected', 'true')
    localStorage.removeItem('ficha-lead-pestana')
  })

  it('quien tenía el copiloto plegado entra a la ficha', () => {
    localStorage.removeItem('ficha-lead-pestana')
    localStorage.setItem('copiloto-ia-plegado', '1')
    renderPanel()
    expect(screen.getByRole('tab', { name: /Ficha/ })).toHaveAttribute('aria-selected', 'true')
    localStorage.removeItem('copiloto-ia-plegado')
  })

  it('se recorre con las flechas del teclado', async () => {
    localStorage.removeItem('ficha-lead-pestana')
    const user = userEvent.setup()
    renderPanel()
    screen.getByRole('tab', { name: /Copiloto IA/ }).focus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /Ficha/ })).toHaveFocus()
    expect(screen.getByRole('tab', { name: /Ficha/ })).toHaveAttribute('aria-selected', 'true')
    localStorage.removeItem('ficha-lead-pestana')
  })
})
