import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, Loader2, RefreshCw, Search, SlidersHorizontal, UserPlus, X } from 'lucide-react'
import { LEAD_STAGES, type Chat, type ChatFilters, type LeadStage, type LeadUpdateInput } from '../types'
import { useCreateLead } from '../hooks/useChats'
import { useTags } from '../hooks/useLeadMeta'
import { extractErrorMessage } from '../utils/errors'
import { ChatItem } from './ChatItem'
import { LeadFormDialog } from './LeadFormDialog'

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
}

const ROW_ESTIMATE_PX = 68
const HIGHLIGHT_DURATION_MS = 2000

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
        <Loader2 className="w-4 h-4 text-gray-300 dark:text-gray-600 animate-spin" />
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
}: Props) {
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [showFilters, setShowFilters] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { mutate: createLead, isPending: isSavingNewLead } = useCreateLead()
  const { data: tags = [] } = useTags()

  const activeAdvancedFilterCount =
    advancedFilters.stages.length +
    advancedFilters.tagIds.length +
    Number(!!advancedFilters.service) +
    Number(!!advancedFilters.seller) +
    Number(!!advancedFilters.origin) +
    Number(!!advancedFilters.lastSender) +
    Number(!!advancedFilters.inactiveDays)

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
      seller: '',
      origin: '',
      lastSender: '',
      inactiveDays: null,
    })
  }

  function handleCreateLead(values: LeadUpdateInput) {
    setCreateError(null)
    createLead(
      {
        phone: values.phone ?? '',
        name: values.name ?? '',
        servicio_interes: values.servicio_interes,
        vendedor: values.vendedor,
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

  return (
    <div className="flex flex-col h-full bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-sm font-semibold text-gray-900 dark:text-gray-100">Leads</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                setCreateError(null)
                setIsCreating(true)
              }}
              aria-label="Agregar lead"
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-500 font-medium transition-colors"
            >
              <UserPlus className="w-3.5 h-3.5" />
              Agregar
            </button>
            <button
              onClick={handleRefresh}
              disabled={isManualRefreshing}
              className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-500 font-medium transition-colors disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isManualRefreshing ? 'animate-spin' : ''}`} />
              Actualizar
            </button>
          </div>
        </div>
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 dark:text-gray-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Buscar lead..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            className="w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg pl-9 pr-3 py-2 outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500"
          />
        </div>
        <div className="mt-2 flex rounded-lg bg-gray-100 p-1 dark:bg-gray-800" role="group" aria-label="Filtrar leads">
          <button
            type="button"
            onClick={() => onFilterChange('all')}
            aria-pressed={filter === 'all'}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === 'all'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            Todos
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('unread')}
            aria-pressed={filter === 'unread'}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === 'unread'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            No leídos
            {unreadCount > 0 && (
              <span className="min-w-4 rounded-full bg-green-600 px-1 text-[10px] leading-4 text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => onFilterChange('mine')}
            aria-pressed={filter === 'mine'}
            className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              filter === 'mine'
                ? 'bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-gray-100'
                : 'text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200'
            }`}
          >
            Mis leads
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowFilters((value) => !value)}
          className={`mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
            showFilters || activeAdvancedFilterCount > 0
              ? 'border-green-300 bg-green-50 text-green-700 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400'
              : 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filtros avanzados
          {activeAdvancedFilterCount > 0 && (
            <span className="min-w-4 rounded-full bg-green-600 px-1 text-[10px] leading-4 text-white">
              {activeAdvancedFilterCount}
            </span>
          )}
        </button>

        {showFilters && (
          <div className="mt-2 max-h-80 space-y-3 overflow-y-auto rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-800/60">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Etapas</span>
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
                  className={`rounded-full border px-2 py-1 text-[11px] capitalize ${
                    advancedFilters.stages.includes(stage)
                      ? 'border-green-500 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-300'
                      : 'border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400'
                  }`}
                >
                  {stage.replace('_', ' ')}
                </button>
              ))}
            </div>

            {tags.length > 0 && (
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">Etiquetas</span>
                  <select
                    value={advancedFilters.tagMode}
                    onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, tagMode: event.target.value as 'any' | 'all' })}
                    className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] text-gray-500 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400"
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
                      className={`rounded-full border px-2 py-1 text-[11px] ${
                        advancedFilters.tagIds.includes(tag.id)
                          ? 'text-white'
                          : 'border-gray-200 bg-white text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
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
                ['seller', 'Vendedor'],
                ['origin', 'Origen'],
              ] as const).map(([key, label]) => (
                <input
                  key={key}
                  value={advancedFilters[key]}
                  onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, [key]: event.target.value })}
                  placeholder={label}
                  className="min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-green-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
                />
              ))}
              <select
                value={advancedFilters.lastSender}
                onChange={(event) => onAdvancedFiltersChange({ ...advancedFilters, lastSender: event.target.value as ChatFilters['lastSender'] })}
                className="rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300"
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
                className="min-w-0 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-green-400 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200"
              />
            </div>
          </div>
        )}
      </div>

      {/* List */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {isLoading && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Cargando leads...</p>
        )}
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">
            Error al cargar leads.
          </p>
        )}
        {!isLoading && chats.length === 0 && !error && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">
            {filter === 'unread' && !search
              ? 'No hay chats sin leer.'
              : filter === 'mine' && !search
                ? 'No tenés leads asignados.'
                : 'Sin resultados.'}
          </p>
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
        />
      )}
    </div>
  )
}
