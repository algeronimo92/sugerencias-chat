import { lazy, Suspense, useEffect, useState } from 'react'
import { useLocation, useMatch, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { toast } from 'sonner'
import { MessagesSquare, Sparkles, X } from 'lucide-react'
import type { Chat } from '../types'
import { ChatList } from './ChatList'
import { ChatPeekDialog } from './ChatPeekDialog'
import { ChatThread } from './ChatThread'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import { useLayoutContext } from './layout/layoutContext'
import { PageLoader } from './layout/PageLoader'
import { useLayout } from '../hooks/useBreakpoint'
import { useMe } from '../hooks/useAuth'
import { useChat, useInfiniteChats, useMarkChatRead, useMarkChatUnread, useUnreadCount } from '../hooks/useChats'
import { useOpenChat } from '../hooks/useOpenChat'
import { useSuggestionStatus, useGenerateSuggestions } from '../hooks/useSuggestions'
import { useWhatsappStatus } from '../hooks/useWhatsapp'
import { hasOpenOverlay } from '../utils/overlay'
import { extractErrorMessage } from '../utils/errors'

const SuggestionPanel = lazy(() =>
  import('./SuggestionPanel').then(module => ({ default: module.SuggestionPanel })),
)

export function ChatWorkspace() {
  const { data: me } = useMe()
  const chatId = useMatch('/chat/:chatId')?.params.chatId ?? null
  const navigate = useNavigate()
  const location = useLocation()
  const handleSelectChat = useOpenChat()
  const { chatFilters, openSettings } = useLayoutContext()
  const { search, setSearch, debouncedSearch, chatFilter, setChatFilter, advancedFilters, setAdvancedFilters, effectiveFilters } = chatFilters

  // 'mobile' = una vista a la vez + navegación inferior; 'tablet' = lista y
  // conversación, con las sugerencias en un panel deslizable; 'desktop' = las
  // tres columnas de siempre.
  const layout = useLayout()
  const isMobile = layout === 'mobile'
  const isDesktop = layout === 'desktop'
  const [isSuggestionsOpen, setIsSuggestionsOpen] = useState(false)
  const [previewChat, setPreviewChat] = useState<Chat | null>(null)
  const { data: unreadCount = 0 } = useUnreadCount()

  const {
    data,
    isLoading,
    error,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
  } = useInfiniteChats(debouncedSearch, effectiveFilters)
  const chats = data?.pages.flatMap((page) => page.items) ?? []

  // Estado de la conexión de WhatsApp — solo admin (el endpoint es admin-only).
  // Alimenta el CTA del estado vacío cuando la instancia no está vinculada.
  const { data: whatsappStatus } = useWhatsappStatus({ enabled: me?.role === 'admin' })
  const showConnectWhatsapp = me?.role === 'admin' && whatsappStatus != null && whatsappStatus.state !== 'open'

  async function handleLoadMore(): Promise<void> {
    if (hasNextPage && !isFetchingNextPage) await fetchNextPage()
  }

  // Consulta directa por clave primaria, independiente de la búsqueda de la lista.
  const { data: selectedChat = null } = useChat(chatId ?? null)

  // Sugerencias a demanda: al abrir un chat solo se LEE lo ya generado
  // (gratis, sin IA). Generar es siempre una acción explícita del vendedor.
  // Si llega un mensaje nuevo del cliente, useChatUpdates invalida esta query
  // y el refetch apenas marca la sugerencia como desactualizada (stale).
  const { data: suggestionStatus = null, isLoading: isSuggestionsLoading } =
    useSuggestionStatus(selectedChat?.chat_id ?? null)

  // Única vía que llama a la IA: CTA "Generá sugerencias" / "Generá otras".
  const generateSuggestionsMutation = useGenerateSuggestions()
  const isGeneratingForSelected =
    generateSuggestionsMutation.isPending &&
    generateSuggestionsMutation.variables?.chat_id === selectedChat?.chat_id
  const suggestionsErrorMessage =
    generateSuggestionsMutation.error instanceof Error &&
    generateSuggestionsMutation.variables?.chat_id === selectedChat?.chat_id
      ? generateSuggestionsMutation.error.message
      : null

  const { mutate: markChatRead } = useMarkChatRead()
  const markChatUnread = useMarkChatUnread()

  // Marca el chat como visto solo cuando realmente está visible. Si queda
  // seleccionado mientras la ventana está en segundo plano, sus mensajes
  // siguen pendientes hasta que el usuario regrese.
  useEffect(() => {
    function markVisibleChatRead() {
      if (chatId && selectedChat && selectedChat.unread_count > 0 && !document.hidden && document.hasFocus()) {
        markChatRead(chatId)
      }
    }

    markVisibleChatRead()
    window.addEventListener('focus', markVisibleChatRead)
    document.addEventListener('visibilitychange', markVisibleChatRead)
    return () => {
      window.removeEventListener('focus', markVisibleChatRead)
      document.removeEventListener('visibilitychange', markVisibleChatRead)
    }
    // selectedChat.timestamp cambia si llega un mensaje al chat abierto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chatId, selectedChat?.unread_count])

  function handleCloseChat() {
    navigate('/')
  }

  function handleMarkChatUnread(chat: Chat) {
    if (chat.chat_id === chatId) handleCloseChat()
    markChatUnread.mutate(chat.chat_id, {
      onSuccess: () => toast.success(`${chat.name || chat.phone || 'Chat'} marcado como no leído`),
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  // Fuera de escritorio las sugerencias son un panel superpuesto: al saltar a
  // otro lead tiene que cerrarse, o quedaría mostrando el anterior.
  useEffect(() => {
    setIsSuggestionsOpen(false)
  }, [chatId])

  // El panel de sugerencias, compartido por la columna de escritorio y el
  // panel deslizable de móvil/tablet.
  function renderSuggestionPanel(chat: Chat) {
    return (
      <SuggestionPanel
        chat={chat}
        data={suggestionStatus?.suggestion ?? null}
        generatedAt={suggestionStatus?.generated_at ?? null}
        isStale={suggestionStatus?.stale ?? false}
        isLoading={isSuggestionsLoading}
        isGenerating={isGeneratingForSelected}
        error={suggestionsErrorMessage}
        onGenerate={(force = false, instruction) =>
          generateSuggestionsMutation.mutate({
            chat_id: chat.chat_id,
            phone: chat.phone,
            force,
            instruction,
          })
        }
      />
    )
  }

  // Escape cierra el lead abierto, igual que WhatsApp
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      // Una pulsación cierra una sola capa, la de más arriba. Con un diálogo
      // encima (la vista previa de una plantilla, el visor de multimedia, un
      // confirmar…) el Escape es de ese diálogo y el lead de atrás no se toca.
      if (hasOpenOverlay()) return
      // El panel de sugerencias no es un diálogo pero también tapa el chat.
      if (isSuggestionsOpen) {
        setIsSuggestionsOpen(false)
        return
      }
      if (selectedChat) {
        handleCloseChat()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedChat?.chat_id, isSuggestionsOpen])

  return (
    <>
    <div className="relative flex min-w-0 flex-1 overflow-hidden">
      {/* Panel izquierdo — Lista de chats.
          En móvil ocupa la pantalla entera y se retira al abrir un chat:
          no hay lugar para las dos cosas a la vez. Se oculta con
          invisible + absolute (no display:none): un contenedor con
          display:none pierde el scroll del todo al ocultarse -no hay
          forma de restaurarlo después, ni con JS-, mientras que
          visibility:hidden conserva el layout y con él la posición de
          scroll: absolute lo saca del flujo para que el chat pueda
          ocupar el ancho completo. */}
      <div className={`h-full overflow-hidden ${isMobile ? (chatId ? 'invisible pointer-events-none absolute inset-0' : 'w-full') : 'w-72 shrink-0 xl:w-80'}`}>
        <ChatList
          chats={chats}
          isLoading={isLoading}
          error={!!error}
          search={search}
          onSearchChange={setSearch}
          filter={chatFilter}
          onFilterChange={setChatFilter}
          unreadCount={unreadCount}
          advancedFilters={advancedFilters}
          onAdvancedFiltersChange={setAdvancedFilters}
          onRefresh={async () => { await refetch() }}
          selectedId={selectedChat?.chat_id ?? null}
          onSelect={handleSelectChat}
          onPreview={setPreviewChat}
          onMarkUnread={handleMarkChatUnread}
          markingUnreadId={markChatUnread.isPending ? markChatUnread.variables : null}
          hasNextPage={!!hasNextPage}
          isFetchingNextPage={isFetchingNextPage}
          hasNextPageError={isFetchNextPageError}
          onLoadMore={handleLoadMore}
          showConnectWhatsapp={showConnectWhatsapp}
          onConnectWhatsapp={() => openSettings('whatsapp')}
        />
      </div>

      {/* Panel central — Conversación */}
      {(!isMobile || chatId) && (
        <div className="h-full min-w-0 flex-1 overflow-hidden">
          {selectedChat ? (
            <ChatThread
              chat={selectedChat}
              highlightMessageId={(location.state as { highlightMessageId?: number } | null)?.highlightMessageId ?? null}
              onBack={isMobile ? handleCloseChat : undefined}
              onOpenSuggestions={isDesktop ? undefined : () => setIsSuggestionsOpen(true)}
            />
          ) : chatId ? (
            /* El lead todavía no llegó (entrada directa por URL o
               recarga). En móvil la lista está oculta, así que sin esta
               rama la pantalla quedaría sin salida. */
            <div className="flex h-full flex-col items-center justify-center gap-4 bg-wa-app dark:bg-wa-panel-dark">
              <Spinner label="Abriendo la conversación…" />
              {isMobile && (
                <Button variant="ghost" size="sm" onClick={handleCloseChat}>
                  Volver a la lista
                </Button>
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 border-b-[6px] border-wa-primary bg-wa-app px-6 text-center text-wa-muted/50 dark:border-wa-primary/60 dark:bg-wa-panel-dark dark:text-wa-muted-dark/50">
              <MessagesSquare className="w-12 h-12" strokeWidth={1.25} />
              <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Selecciona un lead para ver la conversación</p>
            </div>
          )}
        </div>
      )}

      {/* Panel derecho — Sugerencias. Solo en escritorio: por debajo de
          1280px las tres columnas dejarían la conversación inusable, así
          que las sugerencias pasan a un panel deslizable. */}
      {isDesktop && (
        <div className="h-full w-96 shrink-0 overflow-hidden border-l border-wa-border bg-wa-app dark:border-wa-muted-dark/30 dark:bg-wa-panel-dark">
          {selectedChat ? (
            renderSuggestionPanel(selectedChat)
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-wa-muted/50 dark:text-wa-muted-dark/50">
              <Sparkles className="w-12 h-12" strokeWidth={1.25} />
              <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center px-6">Selecciona un lead para ver las sugerencias</p>
            </div>
          )}
        </div>
      )}
    </div>

      {previewChat && (
        <ChatPeekDialog
          chat={previewChat}
          onClose={() => setPreviewChat(null)}
          onOpen={() => {
            const chat = previewChat
            setPreviewChat(null)
            handleSelectChat(chat)
          }}
        />
      )}

      {/* Sugerencias como panel deslizable en móvil y tablet. */}
      <AnimatePresence>
        {!isDesktop && isSuggestionsOpen && selectedChat && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setIsSuggestionsOpen(false)}
              /* aria-hidden y sin handler de teclado a propósito: un fondo de
                 modal no debe ser un punto de tabulación más. Quien navega con
                 teclado cierra con Escape (ver el handler de arriba). */
              aria-hidden="true"
              className="fixed inset-0 z-75 bg-black/40"
            />
            <motion.aside
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
              aria-label="Sugerencias del lead"
              className="fixed inset-y-0 right-0 z-76 flex w-full max-w-md flex-col overflow-hidden border-l border-wa-border bg-wa-app pt-safe dark:border-wa-border-dark dark:bg-wa-panel-dark"
            >
              <div className="flex h-12 shrink-0 items-center justify-between border-b border-wa-border px-3 dark:border-wa-border-dark">
                <span className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Sugerencias</span>
                <button
                  type="button"
                  onClick={() => setIsSuggestionsOpen(false)}
                  aria-label="Cerrar sugerencias"
                  className="flex h-11 w-11 items-center justify-center rounded-lg text-wa-muted hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/5"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <Suspense fallback={<PageLoader />}>{renderSuggestionPanel(selectedChat)}</Suspense>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
