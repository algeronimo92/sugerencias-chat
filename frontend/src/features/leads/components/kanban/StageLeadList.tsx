import { Check, Loader2, Minus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { STAGE_DOT_CLASS, stageColorStyle, type LeadStageCatalog } from '../../domain/leadStageMeta'
import { useKanbanPageSize } from '../../hooks/useKanbanView'
import { useDragAutoScroll } from '../../hooks/useDragAutoScroll'
import { useKanbanStagePage, type KanbanPage } from '../../kanban-queries'
import type { Chat, LeadStage, LeadStageDefinition } from '../../types'
import { LeadRow } from './LeadRow'
import { Pagination } from './Pagination'

interface StageLeadListProps {
  stage: LeadStageDefinition
  catalog: LeadStageCatalog
  search: string
  total: number
  initialPage: KanbanPage | undefined
  movingIds: Set<string>
  selectedIds: Set<string>
  onToggleSelect: (chatId: string) => void
  onSelectMany: (chatIds: string[], selected: boolean) => void
  onClearSelection: () => void
  onOpen: (chat: Chat) => void
  onDragStart: (chat: Chat) => void
  onDragEnd: () => void
  /** Hay un lead en el aire: la lista se desplaza sola cerca de sus bordes. */
  isDragging: boolean
  onMove: (chat: Chat, stage: LeadStage) => void
}

/** Los leads de la etapa elegida, por páginas de 10, 20 o 50. */
export function StageLeadList({
  stage,
  catalog,
  search,
  total,
  initialPage,
  movingIds,
  selectedIds,
  onToggleSelect,
  onSelectMany,
  onClearSelection,
  onOpen,
  onDragStart,
  onDragEnd,
  isDragging,
  onMove,
}: StageLeadListProps) {
  const [pageSize, setPageSize] = useKanbanPageSize()
  const [requestedPage, setRequestedPage] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  useDragAutoScroll(scrollRef, 'y', isDragging)
  useEffect(() => setRequestedPage(0), [search])

  // Si al mover leads la etapa se achica, la última página puede dejar de
  // existir: se muestra la última que quede en vez de una vacía.
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const page = Math.min(requestedPage, pageCount - 1)
  const offset = page * pageSize

  // El snapshot trae los primeros leads de cada etapa: las páginas que caen
  // dentro de ellos no piden nada al servidor.
  const snapshotItems = initialPage?.items ?? []
  const fromSnapshot = initialPage !== undefined && (offset + pageSize <= snapshotItems.length || !initialPage.has_more)
  const { data: fetchedPage, isPending, isFetching, isError, refetch } = useKanbanStagePage(stage.key, search, offset, pageSize, !fromSnapshot)
  const chats = fromSnapshot ? snapshotItems.slice(offset, offset + pageSize) : fetchedPage?.items ?? []
  const isLoadingPage = !fromSnapshot && isPending
  const allVisibleSelected = chats.length > 0 && chats.every((chat) => selectedIds.has(chat.chat_id))
  const selectedCount = selectedIds.size

  function goToPage(next: number) {
    setRequestedPage(next)
    scrollRef.current?.scrollTo({ top: 0 })
  }

  return (
    <section aria-labelledby="stage-list-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
      {/* Con selección, esta fila pasa a decir cuántos hay y cómo cancelar,
          como en la bandeja de chats; las acciones van en la barra de abajo.
          La casilla se alinea con las de las filas. */}
      <header style={stageColorStyle(stage.color)} className={`flex min-h-14 shrink-0 flex-wrap items-center gap-x-2 border-b border-wa-border pr-4 sm:pr-6 md:pl-6 dark:border-wa-border-dark ${
        selectedCount > 0 ? 'bg-wa-primary-strong/5 dark:bg-wa-primary/10' : 'bg-wa-panel dark:bg-wa-panel-dark'
      }`}>
        {chats.length > 0 && (
          <button
            type="button"
            onClick={() => onSelectMany(chats.map((chat) => chat.chat_id), !allVisibleSelected)}
            aria-label={allVisibleSelected ? 'Quitar selección de esta página' : chats.length === total ? 'Seleccionar todos' : `Seleccionar los ${chats.length} de esta página`}
            aria-pressed={allVisibleSelected ? true : selectedCount > 0 ? 'mixed' : false}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong"
          >
            <span className={`flex h-5 w-5 items-center justify-center rounded border ${selectedCount > 0 ? 'border-wa-primary-strong bg-wa-primary-strong text-white' : 'border-wa-muted bg-wa-panel dark:border-wa-muted-dark dark:bg-wa-head-dark'}`}>
              {allVisibleSelected ? <Check className="h-3 w-3" aria-hidden="true" /> : selectedCount > 0 && <Minus className="h-3 w-3" aria-hidden="true" />}
            </span>
          </button>
        )}
        {selectedCount > 0 ? (
          <>
            <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark" role="status">
              {selectedCount} seleccionado{selectedCount === 1 ? '' : 's'}
            </p>
            <h2 id="stage-list-title" className="sr-only">{stage.name}</h2>
            <button
              type="button"
              onClick={onClearSelection}
              className="ml-auto flex h-9 shrink-0 items-center gap-1 rounded-md px-2.5 text-sm font-medium text-wa-muted hover:bg-wa-hover hover:text-wa-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark"
            >
              <X className="h-4 w-4" aria-hidden="true" /> Cancelar
            </button>
          </>
        ) : (
          <>
            <span className={`h-3 w-3 shrink-0 rounded-full ${STAGE_DOT_CLASS} ${chats.length > 0 ? '' : 'ml-4 md:ml-0'}`} aria-hidden="true" />
            <h2 id="stage-list-title" className="text-base font-semibold text-wa-text dark:text-wa-text-dark">
              {stage.name}
              {!stage.is_active && <span className="ml-1.5 text-xs font-normal text-wa-muted dark:text-wa-muted-dark">(inactiva)</span>}
            </h2>
            <span className="text-sm text-wa-muted dark:text-wa-muted-dark">
              {total} {total === 1 ? 'lead' : 'leads'}
            </span>
            {stage.description && <p className="ml-auto hidden max-w-md truncate text-xs text-wa-muted lg:block dark:text-wa-muted-dark" title={stage.description}>{stage.description}</p>}
          </>
        )}
      </header>

      <div ref={scrollRef} className="relative min-h-0 flex-1 overflow-y-auto" aria-busy={isFetching && !fromSnapshot}>
        {isLoadingPage ? (
          <div className="flex items-center justify-center gap-2 py-10 text-sm text-wa-muted dark:text-wa-muted-dark" role="status">
            <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Cargando leads…
          </div>
        ) : isError && chats.length === 0 ? (
          <div role="alert" className="m-4 flex flex-col items-center gap-3 rounded-lg border border-red-500/30 px-4 py-8 text-center text-sm text-red-700 sm:m-6 dark:text-red-300">
            No se pudo cargar esta página.
            <button type="button" onClick={() => void refetch()} className="min-h-9 rounded-md border border-wa-border px-3 font-medium text-wa-text hover:bg-wa-hover dark:border-wa-border-dark dark:text-wa-text-dark dark:hover:bg-wa-hover-dark">
              Reintentar
            </button>
          </div>
        ) : chats.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-wa-border px-4 py-10 text-center text-sm text-wa-muted sm:m-6 dark:border-wa-border-dark dark:text-wa-muted-dark">
            {search ? 'Sin coincidencias en esta etapa.' : 'Ningún lead en esta etapa todavía.'}
          </div>
        ) : (
          <ul aria-label={`Leads en ${stage.name}`} className={`bg-wa-panel transition-opacity dark:bg-wa-panel-dark ${isFetching && !fromSnapshot ? 'opacity-60' : ''}`}>
            {chats.map((chat) => (
              <LeadRow
                key={chat.chat_id}
                chat={chat}
                catalog={catalog}
                isMoving={movingIds.has(chat.chat_id)}
                isSelected={selectedIds.has(chat.chat_id)}
                onToggleSelect={onToggleSelect}
                onOpen={onOpen}
                onDragStart={onDragStart}
                onDragEnd={onDragEnd}
                onMove={onMove}
              />
            ))}
          </ul>
        )}
      </div>

      {total > 0 && (
        <Pagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={goToPage}
          onPageSizeChange={(size) => {
            setPageSize(size)
            goToPage(0)
          }}
        />
      )}
    </section>
  )
}
