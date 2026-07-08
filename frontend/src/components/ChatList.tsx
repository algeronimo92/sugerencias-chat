import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, Loader2, RefreshCw, Search } from 'lucide-react'
import type { Chat } from '../types'
import { ChatItem } from './ChatItem'

interface Props {
  chats: Chat[]
  isLoading: boolean
  error: boolean
  search: string
  onSearchChange: (value: string) => void
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
  onRefresh,
  selectedId,
  onSelect,
  hasNextPage,
  isFetchingNextPage,
  hasNextPageError,
  onLoadMore,
}: Props) {
  const [isManualRefreshing, setIsManualRefreshing] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

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
  }, [search])

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
          <button
            onClick={handleRefresh}
            disabled={isManualRefreshing}
            className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-500 font-medium transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isManualRefreshing ? 'animate-spin' : ''}`} />
            Actualizar
          </button>
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
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin resultados.</p>
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
    </div>
  )
}
