import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Chat, MessageSearchHit, MessageSearchPage } from '../../leads/types'
import { EMPTY_CHAT_FILTERS } from '../../leads/types'
import { ChatSearchResults } from './ChatSearchResults'

const messageSearch = {
  pages: [] as MessageSearchPage[],
  isLoading: false,
  isError: false,
}
const fetchNextPage = vi.fn()

vi.mock('../../leads/public/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../leads/public/queries')>()
  return {
    ...actual,
    useMessageSearch: () => ({
      data: messageSearch.isLoading ? undefined : { pages: messageSearch.pages },
      isLoading: messageSearch.isLoading,
      isError: messageSearch.isError,
      hasNextPage: false,
      isFetchingNextPage: false,
      isFetchNextPageError: false,
      fetchNextPage,
      refetch: vi.fn(),
    }),
  }
})
vi.mock('../../auth/public/queries', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/public/queries')>()
  return { ...actual, useMe: () => ({ data: { role: 'vendedor' } }) }
})

const contact = (id: string, name: string, overrides: Partial<Chat> = {}) => ({
  chat_id: id, name, phone: '51999000111', last_message: 'Hola', last_message_type: 'text',
  timestamp: '2026-11-11T15:00:00Z', last_customer_message_at: '2026-11-11T15:00:00Z', unread_count: 0, tags: [],
  servicio_interes: 'Limpieza Facial', search_rank: 1, ...overrides,
}) as unknown as Chat

const hit = (id: number, chatId: string, text: string, sender = 'vendedor'): MessageSearchHit => ({
  message_id: id, chat_id: chatId, name: 'Paola', username: 'paoocx.r', sender, text, sent_at: '2026-11-11T15:35:00Z',
})

function wrapper({ children }: PropsWithChildren) {
  return (
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  )
}

function renderResults(props: Partial<Parameters<typeof ChatSearchResults>[0]> = {}) {
  const handlers = { onSelect: vi.fn(), onOpenMessage: vi.fn(), onLoadMoreContacts: vi.fn() }
  render(
    <ChatSearchResults
      term="limpieza facial"
      filters={EMPTY_CHAT_FILTERS}
      contacts={[]}
      contactsTotal={null}
      isLoadingContacts={false}
      contactsError={false}
      hasMoreContacts={false}
      isFetchingMoreContacts={false}
      selectedId={null}
      onPreview={vi.fn()}
      onMarkUnread={vi.fn()}
      markingUnreadId={null}
      {...handlers}
      {...props}
    />,
    { wrapper },
  )
  return handlers
}

beforeEach(() => {
  messageSearch.pages = []
  messageSearch.isLoading = false
  messageSearch.isError = false
  // jsdom no trae IntersectionObserver; acá no se prueba el scroll.
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
})

describe('ChatSearchResults', () => {
  it('separa contactos y mensajes, cada uno con su total', () => {
    messageSearch.pages = [{
      items: [hit(1, 'a', 'PROMOCIÓN LIMPIEZA FACIAL A SOLO 100 SOLES'), hit(2, 'a', 'precios de las limpiezas faciales?', 'cliente')],
      has_more: false, total: 1000, total_capped: true,
    }]
    renderResults({ contacts: [contact('r', 'Rocío Mendoza')], contactsTotal: 1 })

    const contacts = screen.getByRole('region', { name: /Contactos/ })
    expect(within(contacts).getByRole('heading')).toHaveTextContent('Contactos· 1')
    // El contacto explica por qué está: su último mensaje no dice lo buscado.
    expect(within(contacts).getByText(/Servicio:/)).toHaveTextContent('Servicio: Limpieza Facial')

    const messages = screen.getByRole('region', { name: /Mensajes/ })
    expect(within(messages).getByRole('heading')).toHaveTextContent('Mensajes· 1000+')
    // El mismo chat, una fila por mensaje; solo el del negocio lleva la marca.
    expect(within(messages).getAllByRole('button')).toHaveLength(2)
    expect(within(messages).getAllByRole('img', { name: 'Enviado por el negocio' })).toHaveLength(1)
  })

  // Si la sección se mostrara entera, los leads con ese servicio taparían los
  // mensajes, que era la queja.
  it('muestra pocos contactos y deja ver el resto a pedido', async () => {
    const user = userEvent.setup()
    const contacts = ['Ana', 'Bea', 'Carla', 'Dora', 'Eva'].map((name, index) => contact(String(index), name))
    const { onLoadMoreContacts } = renderResults({ contacts, contactsTotal: 42, hasMoreContacts: true })

    const section = screen.getByRole('region', { name: /Contactos/ })
    expect(within(section).getByText('Carla')).toBeInTheDocument()
    expect(within(section).queryByText('Dora')).not.toBeInTheDocument()

    await user.click(within(section).getByRole('button', { name: 'Ver los 42 contactos' }))
    expect(within(section).getByText('Eva')).toBeInTheDocument()
    await user.click(within(section).getByRole('button', { name: 'Cargar más contactos' }))
    expect(onLoadMoreContacts).toHaveBeenCalledOnce()

    await user.click(within(section).getByRole('button', { name: 'Ver menos' }))
    expect(within(section).queryByText('Dora')).not.toBeInTheDocument()
  })

  it('al elegir un mensaje avisa cuál, para abrir el chat en ese mensaje', async () => {
    const user = userEvent.setup()
    const first = hit(7, 'a', 'Incluye limpieza facial profunda')
    messageSearch.pages = [{ items: [first], has_more: false, total: 1 }]
    const { onOpenMessage } = renderResults()

    await user.click(screen.getByRole('button', { name: /@paoocx\.r/ }))
    expect(onOpenMessage).toHaveBeenCalledWith(first)
  })

  it('sin contactos no muestra esa sección; sin mensajes lo dice', () => {
    messageSearch.pages = [{ items: [hit(1, 'a', 'limpieza facial')], has_more: false, total: 1 }]
    renderResults()
    expect(screen.queryByRole('region', { name: /Contactos/ })).not.toBeInTheDocument()
  })

  it('con contactos pero ningún mensaje, lo aclara en la sección', () => {
    messageSearch.pages = [{ items: [], has_more: false, total: 0 }]
    renderResults({ contacts: [contact('r', 'Rocío Mendoza')], contactsTotal: 1 })
    expect(screen.getByText('Ningún mensaje contiene esas palabras.')).toBeInTheDocument()
  })

  it('si no hay nada, dice qué se buscó y qué probar', () => {
    messageSearch.pages = [{ items: [], has_more: false, total: 0 }]
    renderResults()
    expect(screen.getByText('Sin resultados para «limpieza facial».')).toBeInTheDocument()
    expect(screen.getByText(/Prueba con menos palabras/)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })

  it('con una sola letra avisa que todavía no busca en los mensajes', () => {
    renderResults({ term: 'a' })
    expect(screen.getByText(/Escribe al menos 2 letras/)).toBeInTheDocument()
  })

  it('si la búsqueda de mensajes falla, los contactos siguen y se puede reintentar', () => {
    messageSearch.isError = true
    renderResults({ contacts: [contact('r', 'Rocío Mendoza')], contactsTotal: 1 })
    expect(screen.getByText('Rocío Mendoza')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reintentar' })).toBeInTheDocument()
  })
})
