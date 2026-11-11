import { AlertCircle, Loader2, SearchX } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { MIN_MESSAGE_SEARCH_CHARS, useMessageSearch } from '../../leads/public/queries'
import type { Chat, ChatFilters, MessageSearchHit } from '../../leads/types'
import { ChatItem } from './ChatItem'
import { MessageSearchRow } from './MessageSearchRow'

/** Contactos a la vista antes de "Ver todos": si la sección se muestra
 *  entera, los leads que matchean por servicio tapan los mensajes, que era
 *  justo la queja. */
const CONTACTS_PREVIEW = 3

interface Props {
  /** Lo buscado, ya estabilizado (no cada tecla). */
  term: string
  filters: ChatFilters
  contacts: Chat[]
  contactsTotal: number | null
  isLoadingContacts: boolean
  contactsError: boolean
  hasMoreContacts: boolean
  isFetchingMoreContacts: boolean
  onLoadMoreContacts: () => Promise<void> | void
  selectedId: string | null
  onSelect: (chat: Chat) => void
  onPreview: (chat: Chat) => void
  onMarkUnread: (chat: Chat) => void
  markingUnreadId: string | null
  onOpenMessage: (hit: MessageSearchHit) => void
}

function SectionTitle({ id, title, count }: { id: string; title: string; count: string | null }) {
  return (
    <h2 id={id} className="flex items-baseline gap-1.5 px-5 pb-1 pt-3 text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">
      {title}
      {count && <span className="font-normal tabular-nums">· {count}</span>}
    </h2>
  )
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1 px-5 py-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 py-2">
          <Skeleton className="h-11 w-11 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-3 w-5/6" />
          </div>
        </div>
      ))}
    </div>
  )
}

const LINK_CLASS = 'mx-5 my-1 rounded-md py-1.5 text-xs font-semibold text-wa-primary-strong outline-none hover:underline focus-visible:ring-2 focus-visible:ring-wa-primary/50 disabled:opacity-60 dark:text-wa-primary'

/**
 * Resultados del buscador de la bandeja en dos secciones, como WhatsApp:
 * "Contactos" (leads que matchean por sus datos) y "Mensajes" (uno por
 * mensaje, del más nuevo al más viejo).
 *
 * Antes era una sola lista de chats: los leads con ese servicio de interés
 * iban primero sin decir por qué, y de cada chat salía un solo mensaje. Quien
 * buscaba un texto que ya había mandado no lo encontraba.
 */
export function ChatSearchResults({
  term, filters, contacts, contactsTotal, isLoadingContacts, contactsError, hasMoreContacts, isFetchingMoreContacts,
  onLoadMoreContacts, selectedId, onSelect, onPreview, onMarkUnread, markingUnreadId, onOpenMessage,
}: Props) {
  const contactsId = useId()
  const messagesId = useId()
  const [showAllContacts, setShowAllContacts] = useState(false)
  const [openedMessageId, setOpenedMessageId] = useState<number | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)

  const messages = useMessageSearch(term, filters)
  const hits = messages.data?.pages.flatMap(page => page.items) ?? []
  const firstPage = messages.data?.pages[0]
  const messagesTotal = firstPage?.total ?? null
  const searchesMessages = term.replace(/\s/g, '').length >= MIN_MESSAGE_SEARCH_CHARS
  const { hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage } = messages

  // Una búsqueda nueva empieza arriba y con los contactos plegados.
  useEffect(() => {
    setShowAllContacts(false)
    setOpenedMessageId(null)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [term, filters])

  // Más mensajes al acercarse al final. Tras un error no reintenta solo: sin
  // esa guarda quedaría pidiendo en bucle y "Reintentar" no llegaría a verse.
  useEffect(() => {
    const sentinel = sentinelRef.current
    if (!sentinel || !hasNextPage || isFetchingNextPage || isFetchNextPageError) return
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some(entry => entry.isIntersecting)) void fetchNextPage() },
      { root: scrollRef.current, rootMargin: '240px' },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
  }, [hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage, hits.length])

  const isLoadingMessages = searchesMessages && messages.isLoading
  const nothingFound = !isLoadingContacts && !isLoadingMessages && !contactsError && !messages.isError
    && contacts.length === 0 && hits.length === 0
  const visibleContacts = showAllContacts ? contacts : contacts.slice(0, CONTACTS_PREVIEW)
  const contactCount = contactsTotal ?? contacts.length
  const hiddenContacts = contactCount - visibleContacts.length

  return (
    <div ref={scrollRef} className="flex-1 overflow-y-auto pb-1.5">
      {nothingFound && (
        <div className="py-4">
          <EmptyState
            icon={SearchX}
            title={`Sin resultados para «${term}».`}
            description={searchesMessages
              ? 'Prueba con menos palabras o revisa los filtros activos.'
              : `Escribe al menos ${MIN_MESSAGE_SEARCH_CHARS} letras para buscar también en los mensajes.`}
          />
        </div>
      )}

      {(isLoadingContacts || contactsError || contacts.length > 0) && (
        <section aria-labelledby={contactsId}>
          <SectionTitle id={contactsId} title="Contactos" count={isLoadingContacts ? null : String(contactCount)} />
          {isLoadingContacts && <RowsSkeleton rows={2} />}
          {contactsError && (
            <p className="px-5 py-2 text-xs text-red-600 dark:text-red-400">No se pudieron cargar los contactos.</p>
          )}
          {visibleContacts.map(chat => (
            <ChatItem
              key={chat.chat_id}
              chat={chat}
              isSelected={chat.chat_id === selectedId && openedMessageId === null}
              isHighlighted={false}
              search={term}
              showMatchReason
              onClick={() => { setOpenedMessageId(null); onSelect(chat) }}
              onPreview={() => onPreview(chat)}
              onMarkUnread={() => onMarkUnread(chat)}
              isMarkingUnread={markingUnreadId === chat.chat_id}
            />
          ))}
          {!showAllContacts && hiddenContacts > 0 && (
            <button type="button" className={LINK_CLASS} onClick={() => setShowAllContacts(true)}>
              Ver los {contactCount} contactos
            </button>
          )}
          {showAllContacts && hasMoreContacts && (
            <button type="button" className={LINK_CLASS} disabled={isFetchingMoreContacts} onClick={() => void onLoadMoreContacts()}>
              {isFetchingMoreContacts ? 'Cargando…' : 'Cargar más contactos'}
            </button>
          )}
          {showAllContacts && contacts.length > CONTACTS_PREVIEW && (
            <button type="button" className={LINK_CLASS} onClick={() => setShowAllContacts(false)}>
              Ver menos
            </button>
          )}
        </section>
      )}

      {searchesMessages && !nothingFound && (
        <section aria-labelledby={messagesId}>
          <SectionTitle
            id={messagesId}
            title="Mensajes"
            count={messagesTotal === null ? null : `${messagesTotal}${firstPage?.total_capped ? '+' : ''}`}
          />
          {isLoadingMessages && <RowsSkeleton rows={4} />}
          {messages.isError && hits.length === 0 && (
            <p className="flex items-center gap-2 px-5 py-2 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              No se pudieron buscar los mensajes.
              <button type="button" className="font-semibold underline hover:no-underline" onClick={() => void messages.refetch()}>
                Reintentar
              </button>
            </p>
          )}
          {!isLoadingMessages && !messages.isError && hits.length === 0 && (
            <p className="px-5 py-2 text-xs text-wa-muted dark:text-wa-muted-dark">Ningún mensaje contiene esas palabras.</p>
          )}
          {hits.map(hit => (
            <MessageSearchRow
              key={hit.message_id}
              hit={hit}
              search={term}
              isSelected={hit.chat_id === selectedId && hit.message_id === openedMessageId}
              onClick={() => { setOpenedMessageId(hit.message_id); onOpenMessage(hit) }}
            />
          ))}
          {isFetchNextPageError && (
            <p className="flex items-center justify-center gap-2 py-3 text-xs text-red-600 dark:text-red-400">
              <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
              Error al cargar más mensajes.
              <button type="button" className="font-semibold underline hover:no-underline" onClick={() => void fetchNextPage()}>
                Reintentar
              </button>
            </p>
          )}
          <div ref={sentinelRef} className="flex h-8 items-center justify-center">
            {isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin text-wa-muted/60 dark:text-wa-muted-dark/60" aria-label="Cargando más mensajes" />}
          </div>
        </section>
      )}
    </div>
  )
}
