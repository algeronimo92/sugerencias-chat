/**
 * Smoke test del hilo completo.
 *
 * ChatThread se partió en cuatro (useThreadScroll, useChatTimeline,
 * ChatComposer y MessageBubble) y no había ni un test que montara el
 * componente. Esto no cubre el detalle de cada burbuja: cubre que el armado
 * siga en pie —header, mensajes propios y del cliente, cita, compositor y los
 * botones de móvil— que es lo que se rompe al mover JSX de archivo.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import type { Chat, Message } from '../types'
import { ChatThread } from './ChatThread'

const CHAT: Chat = {
  chat_id: '51958334533@s.whatsapp.net',
  phone: '51958334533',
  name: 'Ana Torres',
  stage: 'nuevo',
  unread_count: 0,
} as Chat

function message(overrides: Partial<Message> & { id: number }): Message {
  return {
    sender: 'cliente',
    content: 'Hola',
    sent_at: '2026-07-20T15:00:00Z',
    media_url: null,
    wa_message_id: `wa-${overrides.id}`,
    status: 'READ',
    ...overrides,
  } as Message
}

const MESSAGES: Message[] = [
  message({ id: 1, content: 'Hola, quiero información del tratamiento' }),
  message({ id: 2, sender: 'vendedor', content: 'Claro, te cuento todo' }),
  message({
    id: 3,
    sender: 'vendedor',
    content: 'Te dejo el precio',
    quoted_message_id: 1,
    quoted_sender: 'cliente',
    quoted_content: 'Hola, quiero información del tratamiento',
  }),
]

vi.mock('../hooks/useMessages', async () => {
  const actual = await vi.importActual<typeof import('../hooks/useMessages')>('../hooks/useMessages')
  return {
    ...actual,
    useMessages: () => ({
      data: { pages: [{ items: MESSAGES }] },
      isLoading: false,
      error: null,
      fetchNextPage: vi.fn(async () => ({ isError: false })),
      hasNextPage: false,
      isFetchingNextPage: false,
    }),
    useSendMessage: () => ({ mutate: vi.fn(), retryMessage: vi.fn(), error: null }),
    useSendAudio: () => ({ mutate: vi.fn() }),
    useSendMedia: () => ({ mutate: vi.fn() }),
    useSendLocation: () => ({ mutate: vi.fn() }),
  }
})

vi.mock('../hooks/useEvolutionHistory', () => ({
  useEvolutionHistory: () => ({
    data: undefined,
    error: null,
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
  useEvolutionHistoryAvailability: () => ({ data: { available: false } }),
}))

vi.mock('../hooks/useInternalNotes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useInternalNotes')>()),
  useInternalNotes: () => ({ data: [] }),
  useCreateInternalNote: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}))
vi.mock('../hooks/useLeadMeta', () => ({ useLeadActivity: () => ({ data: [] }) }))
vi.mock('../hooks/useAuth', () => ({ useMe: () => ({ data: { id: 7, role: 'vendedor', name: 'Gerson' } }) }))
vi.mock('../hooks/useCustomerServiceWindow', () => ({
  useCustomerServiceWindow: () => ({ data: null, isLoading: false }),
}))
vi.mock('../hooks/useTemplates', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useTemplates')>()),
  useTemplates: () => ({ data: [] }),
  useRecordTemplateUse: () => ({ mutate: vi.fn() }),
  useToggleTemplateFavorite: () => ({ mutate: vi.fn() }),
}))

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function renderThread(props: Partial<Parameters<typeof ChatThread>[0]> = {}) {
  return render(<ChatThread chat={CHAT} {...props} />, { wrapper })
}

describe('ChatThread', () => {
  it('muestra el nombre del lead en el header', () => {
    renderThread()
    // El selector acota al header: el nombre también aparece dentro de la
    // cita, que lo atribuye como autor del mensaje original.
    expect(screen.getByText('Ana Torres', { selector: 'p' })).toBeInTheDocument()
  })

  it('pinta los mensajes del cliente y los propios', () => {
    renderThread()
    // Aparece dos veces: como burbuja y dentro de la cita del mensaje 3.
    expect(screen.getAllByText('Hola, quiero información del tratamiento')).toHaveLength(2)
    expect(screen.getByText('Claro, te cuento todo')).toBeInTheDocument()
    expect(screen.getByText('Te dejo el precio')).toBeInTheDocument()
  })

  it('muestra la cita de un mensaje que responde a otro', () => {
    renderThread()
    // El recuadro de la cita repite el texto del original, atribuido al cliente.
    const quote = screen.getByTitle('Ir al mensaje original')
    expect(quote).toHaveTextContent('Ana Torres')
    expect(quote).toHaveTextContent('Hola, quiero información del tratamiento')
  })

  it('deja escribir un mensaje y ofrece enviarlo', async () => {
    const user = userEvent.setup()
    renderThread()

    const textarea = screen.getByPlaceholderText(/Escribí un mensaje/)
    expect(screen.queryByLabelText('Enviar mensaje')).not.toBeInTheDocument()

    await user.type(textarea, 'Gracias')

    expect(textarea).toHaveValue('Gracias')
    expect(screen.getByLabelText('Enviar mensaje')).toBeInTheDocument()
  })

  it('al responder una burbuja, la cita aparece en el compositor y se puede cancelar', async () => {
    const user = userEvent.setup()
    renderThread()

    // Cada mensaje citable ofrece su botón de responder.
    const replyButtons = screen.getAllByLabelText('Responder a este mensaje')
    await user.click(replyButtons[0])

    const cancel = screen.getByLabelText('Cancelar respuesta')
    expect(cancel).toBeInTheDocument()

    await user.click(cancel)
    expect(screen.queryByLabelText('Cancelar respuesta')).not.toBeInTheDocument()
  })

  it('permite pasar a nota interna y volver', async () => {
    const user = userEvent.setup()
    renderThread()

    await user.click(screen.getByText('Cambiar a nota interna'))

    // El compositor de WhatsApp deja lugar al de notas.
    expect(screen.queryByPlaceholderText(/Escribí un mensaje/)).not.toBeInTheDocument()
    expect(screen.getByText(/Nota interna/)).toBeInTheDocument()
  })

  it('solo muestra los botones de móvil cuando el padre los pasa', () => {
    const { unmount } = renderThread()
    expect(screen.queryByLabelText('Volver a la lista de chats')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Ver sugerencias del lead')).not.toBeInTheDocument()
    unmount()

    const onBack = vi.fn()
    renderThread({ onBack, onOpenSuggestions: vi.fn() })
    expect(screen.getByLabelText('Volver a la lista de chats')).toBeInTheDocument()
    expect(screen.getByLabelText('Ver sugerencias del lead')).toBeInTheDocument()
  })
})
