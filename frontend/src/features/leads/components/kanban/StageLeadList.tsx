import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { STAGE_DOT_CLASS, stageColorStyle, type LeadStageCatalog } from '../../domain/leadStageMeta'
import { useLoadKanbanStage, type KanbanPage } from '../../kanban-queries'
import type { Chat, LeadStage, LeadStageDefinition } from '../../types'
import { LeadRow } from './LeadRow'

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
  onOpen: (chat: Chat) => void
  onDragStart: (chat: Chat) => void
  onDragEnd: () => void
  onMove: (chat: Chat, stage: LeadStage) => void
}

/** Los leads de la etapa elegida, paginados como antes cada columna. */
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
  onOpen,
  onDragStart,
  onDragEnd,
  onMove,
}: StageLeadListProps) {
  const [extraPages, setExtraPages] = useState<KanbanPage[]>([])
  const { mutate: loadPage, isPending: isLoadingPage, isError: isPageError, reset: resetPage } = useLoadKanbanStage()
  useEffect(() => {
    setExtraPages([])
    resetPage()
  }, [initialPage, search, stage.key, resetPage])
  const chats = [...(initialPage?.items ?? []), ...extraPages.flatMap((page) => page.items)]
  const lastPage = extraPages.at(-1) ?? initialPage
  const hasNextPage = lastPage?.has_more ?? false
  const allVisibleSelected = chats.length > 0 && chats.every((chat) => selectedIds.has(chat.chat_id))

  function fetchNextPage() {
    loadPage(
      { stage: stage.key, search, offset: chats.length },
      { onSuccess: (page) => setExtraPages((current) => [...current, page]) }
    )
  }

  return (
    <section aria-labelledby="stage-list-title" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header style={stageColorStyle(stage.color)} className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-wa-border bg-wa-panel px-4 py-3 sm:px-6 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <span className={`h-3 w-3 shrink-0 rounded-full ${STAGE_DOT_CLASS}`} aria-hidden="true" />
        <h2 id="stage-list-title" className="text-base font-semibold text-wa-text dark:text-wa-text-dark">
          {stage.name}
          {!stage.is_active && <span className="ml-1.5 text-xs font-normal text-wa-muted dark:text-wa-muted-dark">(inactiva)</span>}
        </h2>
        <span className="text-sm text-wa-muted dark:text-wa-muted-dark">
          {total} {total === 1 ? 'lead' : 'leads'}
        </span>
        {chats.length > 0 && (
          <button
            type="button"
            onClick={() => onSelectMany(chats.map((chat) => chat.chat_id), !allVisibleSelected)}
            className="ml-auto min-h-9 rounded-md px-2.5 text-sm font-medium text-wa-primary-strong hover:bg-wa-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong dark:text-wa-primary dark:hover:bg-wa-hover-dark"
          >
            {allVisibleSelected ? 'Quitar selección' : `Seleccionar ${chats.length === total ? 'todos' : `los ${chats.length} visibles`}`}
          </button>
        )}
        {stage.description && <p className="w-full text-xs text-wa-muted dark:text-wa-muted-dark">{stage.description}</p>}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {chats.length === 0 ? (
          <div className="m-4 rounded-lg border border-dashed border-wa-border px-4 py-10 text-center text-sm text-wa-muted sm:m-6 dark:border-wa-border-dark dark:text-wa-muted-dark">
            {search ? 'Sin coincidencias en esta etapa.' : 'Ningún lead en esta etapa todavía.'}
          </div>
        ) : (
          <ul aria-label={`Leads en ${stage.name}`} className="bg-wa-panel dark:bg-wa-panel-dark">
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
        {hasNextPage && (
          <div className="p-4">
            <button
              type="button"
              onClick={() => fetchNextPage()}
              disabled={isLoadingPage}
              className="mx-auto flex min-h-10 items-center justify-center gap-2 rounded-lg border border-wa-border bg-wa-panel px-4 text-sm font-medium text-wa-text hover:bg-wa-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong disabled:cursor-wait dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
            >
              {isLoadingPage && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
              Cargar más ({total - chats.length} restantes)
            </button>
          </div>
        )}
        {isPageError && <p role="alert" className="pb-4 text-center text-xs text-red-700 dark:text-red-300">No se cargaron más leads. Vuelve a intentarlo.</p>}
      </div>
    </section>
  )
}
