import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, Loader2, MessagesSquare, RefreshCw, Search, SlidersHorizontal, Smartphone, UserPlus, X } from 'lucide-react'
import { LEAD_STAGES, type Chat, type ChatFilters, type LeadStage, type LeadUpdateInput } from '../types'
import { useChatSocketConnected, useCreateLead } from '../hooks/useChats'
import { useTags } from '../hooks/useLeadMeta'
import { useSellers } from '../hooks/useUsers'
import { extractErrorMessage } from '../utils/errors'
import { ChatItem } from './ChatItem'
import { LeadFormDialog } from './LeadFormDialog'
import { Button, EmptyState, Skeleton } from './ui'

interface Props {
  chats: Chat[]
  isLoading: boolean
  error: boolean
  search: string
  onSearchChange: (value: string) => void
  filter: 'all' | 'unread' | 'mine'
  onFilterChange: (value: 'all' | 'unread' | 'mine') => void
  unreadCount: number
  advancedFilters: ChatFilters
  onAdvancedFiltersChange: (value: ChatFilters) => void
  onRefresh: () => Promise<unknown>
  selectedId: string | null
  onSelect: (chat: Chat) => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  hasNextPageError: boolean
  onLoadMore: () => unknown
  // Muestra un llamado a conectar WhatsApp en el estado vacío (solo admin, y
  // solo cuando la instancia no está vinculada).
  showConnectWhatsapp?: boolean
  onConnectWhatsapp?: () => void
}

const ROW_ESTIMATE_PX = 68
const HIGHLIGHT_DURATION_MS = 2000
// Margen antes de mostrar el aviso de conexión degradada: cubre el parpadeo
// del socket durante el arranque y las reconexiones automáticas (3s de retry).
const OFFLINE_BANNER_DELAY_MS = 5_000

function LoadMoreRow({
  isFetchingNextPage,
  hasNextPageError,
  onRetry,
}: {
  isFetchingNextPage: boolean
  hasNextPageError: boolean
  onRetry: () => void
}) {
  if (hasNextPageError) {
    return (
      <div className="py-3 flex items-center justify-center gap-2 text-xs text-red-500 dark:text-red-400">
        <AlertCircle className="w-3.5 h-3.5" />
        <span>Error al cargar más leads.</span>
        <button
          onClick={onRetry}
          className="font-medium underline hover:no-underline text-red-600 dark:text-red-400"
        >
          Reintentar
        </button>
      </div>
    )
  }

  return (
    <div className="py-4 flex items-center justify-center">
      {isFetchingNextPage && (
        <Loader2 className="w-4 h-4 text-wa-muted/60 dark:text-wa-muted-dark/60 animate-spin" />
      )}
    </div>
  )
}

export function ChatList({
  chats,
  isLoading,
  error,
  search,
  onSearchChange,
  filter,
  onFilterChange,
  unreadCount,
  advancedFilters,
  onAdvancedFiltersChange,
  onRefresh,
  selectedId,
  onSelect,
  hasNextPage,
  isFetchingNextPage,
  hasNextPageError,
  onLoadMore,
  showConnectWhatsapp = false,
  onConnectWhatsapp,
}: Props) {
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)
  const socketConnected = useChatSocketConnected()
  const [showOfflineBanner, setShowOfflineBanner] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { mutate: createLead, isPending: isSavingNewLead } = useCreateLead()
  const { data: tags = [] } = useTags()
  const { data: sellers = [] } = useSellers()

  const activeAdvancedFilterCount =
    advancedFilters.stages.length +
    advancedFilters.tagIds.length +
    Number(!!advancedFilters.service) +
    Number(!!advancedFilters.sellerId) +
    Number(!!advancedFilters.origin) +
    Number(!!advancedFilters.lastSender) +
    Number(!!advancedFilters.inactiveDays) +
    Number(!!advancedFilters.waitingTime)

  function toggleStage(stage: LeadStage) {
    const stages = advancedFilters.stages.includes(stage)
      ? advancedFilters.stages.filter((item) => item !== stage)
      : [...advancedFilters.stages, stage]
    onAdvancedFiltersChange({ ...advancedFilters, stages })
  }

  function toggleTag(tagId: number) {
    const tagIds = advancedFilters.tagIds.includes(tagId)
      ? advancedFilters.tagIds.filter((item) => item !== tagId)
      : [...advancedFilters.tagIds, tagId]
    onAdvancedFiltersChange({ ...advancedFilters, tagIds })
  }

  function clearAdvancedFilters() {
    onAdvancedFiltersChange({
      unreadOnly: false,
      stages: [],
      tagIds: [],
      tagMode: 'any',
      service: '',
      sellerId: null,
      origin: '',
      lastSender: '',
      inactiveDays: null,
      waitingTime: '',
    })
  }

  function handleCreateLead(values: LeadUpdateInput) {
    if (isSavingNewLead) return
    setCreateError(null)
    createLead(
      {
        phone: values.phone ?? '',
        name: values.name ?? '',
        servicio_interes: values.servicio_interes,
        vendedor_id: values.vendedor_id,
        origen: values.origen,
        notas: values.notas,
      },
      {
        onSuccess: (chat) => {
          setIsCreating(false)
          onSelect(chat)
        },
        onError: (err) => setCreateError(extractErrorMessage(err)),
      }
    )
  }

  // Resalta el lead que salta al tope de la lista por un mensaje nuevo en
  // tiempo real, para que no pase desapercibido si el usuario está
  // scrolleado más abajo. Se ignora la primera carga y los cambios de
  // búsqueda (ahí el "tope nuevo" es solo un resultado distinto, no una
  // novedad real).
  const [highlightedId, setHighlightedId] = useState<string | null>(null)
  const prevTopIdRef = useRef<string | null>(null)
  const topId = chats[0]?.chat_id ?? null

  useEffect(() => {
    prevTopIdRef.current = null
    setHighlightedId(null)
    scrollRef.current?.scrollTo({ top: 0 })
  }, [search, filter, advancedFilters])

  useEffect(() => {
    if (prevTopIdRef.current !== null && topId !== null && topId !== prevTopIdRef.current) {
      setHighlightedId(topId)
      const timeout = setTimeout(() => setHighlightedId(null), HIGHLIGHT_DURATION_MS)
      prevTopIdRef.current = topId
      return () => clearTimeout(timeout)
    }
    prevTopIdRef.current = topId
  }, [topId])

  // El WebSocket mantiene la lista al día; el refresh manual solo se ofrece
  // cuando la conexión en tiempo real lleva un rato caída (queda el polling
  // de respaldo de 60s, pero el usuario puede no querer esperarlo).
  useEffect(() => {
    if (socketConnected) {
      setShowOfflineBanner(false)
      return
    }
    const timeout = setTimeout(() => setShowOfflineBanner(true), OFFLINE_BANNER_DELAY_MS)
    return () => clearTimeout(timeout)
  }, [socketConnected])

  async function handleRefresh() {
    setIsManualRefreshing(true)
    try {
      await onRefresh()
    } finally {
      setIsManualRefreshing(false)
    }
  }

  // Fila extra al final para el loader/error de la página siguiente.
  const rowCount = chats.length + (hasNextPage ? 1 : 0)

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_ESTIMATE_PX,
    overscan: 6,
  })

  const virtualItems = rowVirtualizer.getVirtualItems()

  // Lock síncrono aparte de isFetchingNextPage: el array de virtualItems
  // cambia de referencia en re-renders muy seguidos (por ejemplo, el propio
  // recálculo interno del virtualizer), y el efecto de abajo puede volver a
  // ejecutarse antes de que isFetchingNextPage llegue a reflejar "true" en
  // el estado de React Query. Sin este ref, eso dispara fetchNextPage()
  // dos veces para la misma página.
  const isLoadingMoreRef = useRef(false)

  function triggerLoadMore() {
    if (isLoadingMoreRef.current) return
    isLoadingMoreRef.current = true
    Promise.resolve(onLoadMore()).finally(() => {
      isLoadingMoreRef.current = false
    })
  }

  // Patrón recomendado por @tanstack/react-virtual para infinite scroll:
  // si la última fila renderizada ya es (o está por llegar a) la fila de
  // carga, pide la próxima página. El guard de hasNextPageError evita que
  // esto reintente solo en loop apenas falla un fetch: isFetchingNextPage
  // vuelve a false al fallar, así que sin el guard este efecto dispararía
  // otro fetchNextPage de inmediato en cada render, sin que el usuario
  // llegue a ver ni usar el botón "Reintentar".
  useEffect(() => {
    const lastItem = virtualItems[virtualItems.length - 1]
    if (!lastItem) return
    if (lastItem.index >= chats.length - 1 && hasNextPage && !isFetchingNextPage && !hasNextPageError) {
      triggerLoadMore()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtualItems, chats.length, hasNextPage, isFetchingNextPage, hasNextPageError, onLoadMore])

  const segmentClass = (active: boolean) =>
    `flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'bg-white text-wa-text shadow-sm dark:bg-wa-active-dark dark:text-wa-text-dark'
        : 'text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'
    }`

  return (
    <div className="flex flex-col h-full bg-white dark:bg-wa-panel-dark border-r border-wa-border dark:border-wa-border-dark">
      {/* Header */}
      <div className="px-3 py-3 border-b border-wa-border dark:border-wa-border-dark">
        <div className="flex items-center justify-between mb-3 px-1">
          <h1 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Leads</h1>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setCreateError(null)
              setIsCreating(true)
            }}
            aria-label="Agregar lead"
          >
            <UserPlus className="w-3.5 h-3.5" aria-hidden="true" />
            Agregar
          </Button>
        </div>
        {/* Búsqueda en píldora gris, como WhatsApp */}
        <div className="relative">
          <Search className="w-4 h-4 text-wa-muted dark:text-wa-muted-dark absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar lead..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full text-sm bg-wa-field dark:bg-wa-field-dark text-wa-text dark:text-wa-text-dark border border-transparent rounded-full pl-10 pr-3 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark transition-shadow"
          />
        </div>
        <div className="mt-2 flex rounded-lg bg-wa-field p-1 dark:bg-wa-field-dark" role="group" aria-label="Filtrar leads">
          <button
            type="button"
            onClick={() => onFilterChange('all')}
            aria-pressed={filter === 'all'}
            className={segmentClass(filter === 'all')}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('unread')}
            aria-pressed={filter === 'unread'}
            className={`flex items-center justify-center gap-1.5 ${segmentClass(filter === 'unread')}`}
          >
            No leídos
            {unreadCount > 0 && (
              <span className="min-w-4 rounded-full bg-wa-primary px-1 text-[10px] font-semibold leading-4 text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('mine')}
            aria-pressed={filter === 'mine'}
            className={segmentClass(filter === 'mine')}
          >
            Mis leads
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((value) => !value)}
          className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            showFilters || activeAdvancedFilterCount > 0
              ? 'border-wa-primary/40 bg-wa-primary/10 text-wa-primary-strong dark:border-wa-primary/40 dark:bg-wa-primary/15 dark:text-wa-primary'
              : 'border-wa-border text-wa-muted hover:bg-wa-hover dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros avanzados
          {activeAdvancedFilterCount > 0 && (
            <span className="min-w-4 rounded-full bg-wa-primary px-1 text-[10px] font-semibold leading-4 text-white">
              {activeAdvancedFilterCount}
            </span>
          )}
        </button>

        {showFilters && (
          <div className="mt-2 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-wa-border bg-wa-field/60 p-3 dark:border-wa-border-dark dark:bg-wa-field-dark/40">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">Etapas</span>
              {activeAdvancedFilterCount > 0 && (
                <button type="button" onClick={clearAdvancedFilters} className="flex items-center gap-1 text-[11px] text-red-500 hover:text-red-600">
                  <X className="h-3 w-3" /> Limpiar
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LEAD_STAGES.map((stage) => (
                <button
                  key={stage}
                  type="button"
                  onClick={() => toggleStage(stage)}
                  className={`rounded-full border px-2 py-1 text-[11px] capitalize transition-colors ${
                    advancedFilters.stages.includes(stage)
                      ? 'border-wa-primary bg-wa-primary/15 text-wa-primary-strong dark:bg-wa-primary/20 dark:text-wa-primary'
                      : 'border-wa-border bg-white text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark'
                  }`}
                >
                  {stage.replace('_', ' ')}
                </button>
              ))}
            </div>

            {tags.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">Etiquetas</span>
                  <select
                    value={advancedFilters.tagMode}
                    onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, tagMode: event.target.value as 'any' | 'all' })}
                    className="rounded border border-wa-border bg-white px-1.5 py-0.5 text-[10px] text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
                  >
                    <option value="any">Cualquiera</option>
                    <option value="all">Todas</option>
                  </select>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      type="button"
                      onClick={() => toggleTag(tag.id)}
                      className={`rounded-full border px-2 py-1 text-[11px] transition-colors ${
                        advancedFilters.tagIds.includes(tag.id)
                          ? 'text-white'
                          : 'border-wa-border bg-white text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark'
                      }`}
                      style={advancedFilters.tagIds.includes(tag.id) ? { backgroundColor: tag.color, borderColor: tag.color } : undefined}
                    >
                      {tag.name}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              {([
                ['service', 'Servicio'],
                ['origin', 'Origen'],
              ] as const).map(([key, label]) => (
                <input
                  key={key}
                  value={advancedFilters[key]}
                  onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, [key]: event.target.value })}
                  placeholder={label}
                  className="min-w-0 rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-text outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
                />
              ))}
              <select
                value={advancedFilters.sellerId ?? ''}
                onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, sellerId: event.target.value ? Number(event.target.value) : null })}
                className="rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
              >
                <option value="">Cualquier vendedor</option>
                {sellers.map((seller) => <option key={seller.id} value={seller.id}>{seller.name}</option>)}
              </select>
              <select
                value={advancedFilters.lastSender}
                onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, lastSender: event.target.value as ChatFilters['lastSender'] })}
                className="rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
              >
                <option value="">Último emisor</option>
                <option value="cliente">Cliente</option>
                <option value="vendedor">Vendedor</option>
              </select>
              <input
                type="number"
                min={1}
                value={advancedFilters.inactiveDays ?? ''}
                onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, inactiveDays: event.target.value ? Number(event.target.value) : null })}
                placeholder="Inactivo (días)"
                className="min-w-0 rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-text outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
              />
              <select
                value={advancedFilters.waitingTime}
                onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, waitingTime: event.target.value as ChatFilters['waitingTime'] })}
                title="Tiempo desde el último mensaje del cliente sin respuesta del vendedor"
                className="col-span-2 rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark"
              >
                <option value="">Tiempo sin responder</option>
                <option value="any">Todos esperando respuesta</option>
                <option value="fresh">Menos de 10 minutos</option>
                <option value="warning">Entre 10 minutos y 1 hora</option>
                <option value="urgent">Más de 1 hora</option>
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Conexión degradada: el refresh manual solo existe cuando hace falta */}
      {showOfflineBanner && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">Sin conexión en tiempo real</span>
          <button
            onClick={handleRefresh}
            disabled={isManualRefreshing}
            className="flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1 font-semibold transition-colors hover:bg-amber-100 disabled:opacity-50 dark:hover:bg-amber-900/40"
          >
            <RefreshCw className={`h-3 w-3 ${isManualRefreshing ? 'animate-spin' : ''}`} aria-hidden="true" />
            {isManualRefreshing ? 'Actualizando…' : 'Actualizar ahora'}
          </button>
        </div>
      )}

      {/* List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isLoading && (
          <div aria-label="Cargando leads" className="px-3 py-2 space-y-1">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 py-2">
                <Skeleton className="h-12 w-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-2/3" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              </div>
            ))}
          </div>
        )}
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">
            Error al cargar leads.
          </p>
        )}
        {!isLoading && chats.length === 0 && !error && (
          <div className="py-4">
            <EmptyState
              icon={MessagesSquare}
              title={
                search
                  ? 'Sin resultados.'
                  : filter === 'unread'
                    ? 'No hay chats sin leer.'
                    : filter === 'mine'
                      ? 'No tenés leads asignados.'
                      : 'Sin leads todavía.'
              }
            />
            {showConnectWhatsapp && filter === 'all' && !search && (
              <div className="mx-4 mt-2 rounded-xl border border-wa-primary/30 bg-wa-primary/10 p-4 text-left dark:border-wa-primary/30 dark:bg-wa-primary/15">
                <div className="mb-1 flex items-center gap-1.5 text-sm font-semibold text-wa-primary-strong dark:text-wa-primary">
                  <Smartphone className="h-4 w-4" /> Conectá tu WhatsApp
                </div>
                <p className="mb-3 text-xs text-wa-primary-strong/80 dark:text-wa-primary/80">
                  Vinculá tu instancia escaneando el QR para empezar a recibir mensajes.
                </p>
                <button
                  type="button"
                  onClick={onConnectWhatsapp}
                  className="rounded-lg bg-wa-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-wa-primary-strong"
                >
                  Conectar WhatsApp
                </button>
              </div>
            )}
          </div>
        )}
        {!isLoading && chats.length > 0 && (
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((virtualRow) => {
              const isLoaderRow = virtualRow.index >= chats.length
              const chat = !isLoaderRow ? chats[virtualRow.index] : null

              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {chat ? (
                    <ChatItem
                      chat={chat}
                      isSelected={chat.chat_id === selectedId}
                      isHighlighted={chat.chat_id === highlightedId}
                      search={search}
                      onClick={() => onSelect(chat)}
                    />
                  ) : (
                    <LoadMoreRow
                      isFetchingNextPage={isFetchingNextPage}
                      hasNextPageError={hasNextPageError}
                      onRetry={triggerLoadMore}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {isCreating && (
        <LeadFormDialog
          title="Agregar lead"
          submitLabel="Agregar"
          requirePhoneAndName
          isSubmitting={isSavingNewLead}
          error={createError}
          onSubmit={handleCreateLead}
          onCancel={() => setIsCreating(false)}
          onOpenExisting={(chat) => {
            setIsCreating(false)
            onSelect(chat)
          }}
        />
      )}
    </div>
  )
}
