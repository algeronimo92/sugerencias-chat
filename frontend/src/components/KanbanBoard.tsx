import { useEffect, useState, type DragEvent } from 'react'
import { AlertCircle, Check, GripVertical, Loader2, MessageCircle, Search, Tag as TagIcon, UserRound, X } from 'lucide-react'
import type { Chat, LeadStage } from '../types'
import { isLeadStage, LEAD_STAGES } from '../types'
import {
  useBulkAssignTag,
  useBulkMoveStage,
  useKanbanSnapshot,
  useLoadKanbanStage,
  useMoveLeadStage,
  type KanbanPage,
} from '../hooks/useKanban'
import { useTags } from '../hooks/useLeadMeta'
import { LEAD_STAGE_META } from '../domain/leadStageMeta'
import { avatarInitial, displayName } from '../utils/chat'
import { parseContent } from '../utils/message'

interface KanbanCardProps {
  chat: Chat
  isMoving: boolean
  isSelected: boolean
  onToggleSelect: (chatId: string) => void
  onOpen: (chat: Chat) => void
  onDragStart: (chat: Chat) => void
  onDragEnd: () => void
  onMove: (chat: Chat, stage: LeadStage) => void
}

function KanbanCard({ chat, isMoving, isSelected, onToggleSelect, onOpen, onDragStart, onDragEnd, onMove }: KanbanCardProps) {
  const preview = parseContent(chat.last_message)
  const PreviewIcon = preview.icon
  const previewText = preview.kind === 'location' ? preview.label : preview.text || preview.label || 'Sin mensajes'

  return (
    <article
      draggable={!isMoving}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', chat.chat_id)
        onDragStart(chat)
      }}
      onDragEnd={onDragEnd}
      className={`group rounded-xl border bg-white shadow-sm transition-all dark:bg-wa-head-dark ${
        isSelected ? 'border-wa-primary ring-2 ring-wa-primary/30 dark:border-wa-primary' : 'border-wa-border dark:border-wa-border-dark'
      } ${
        isMoving ? 'opacity-50' : 'cursor-grab hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-md active:cursor-grabbing dark:hover:border-gray-600'
      }`}
    >
      {/* div con rol de botón, no <button>: adentro hay otro botón real (el
          checkbox de selección) y los navegadores no permiten anidar
          botones — con dos <button> anidados el checkbox deja de recibir
          el click de forma confiable. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(chat)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            onOpen(chat)
          }
        }}
        className="w-full cursor-pointer p-3 text-left"
        aria-label={`Abrir chat de ${displayName(chat)}`}
      >
        <div className="flex items-start gap-2.5">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onToggleSelect(chat.chat_id)
            }}
            aria-label={isSelected ? `Deseleccionar ${displayName(chat)}` : `Seleccionar ${displayName(chat)}`}
            aria-pressed={isSelected}
            className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
              isSelected
                ? 'border-wa-primary-strong bg-wa-primary text-white'
                : 'border-gray-300 bg-white opacity-0 group-hover:opacity-100 dark:border-gray-600 dark:bg-wa-active-dark'
            }`}
          >
            {isSelected && <Check className="h-3 w-3" />}
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-wa-primary to-wa-primary-strong text-xs font-semibold text-white">
            {avatarInitial(chat)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">{displayName(chat)}</p>
              <GripVertical className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-wa-muted dark:text-gray-600" />
            </div>
            {chat.con_especialista && (
              <span className="mt-1 inline-flex items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
                <UserRound className="h-2.5 w-2.5" /> Con especialista
              </span>
            )}
            <p className="mt-0.5 truncate text-[11px] text-wa-muted dark:text-wa-muted-dark">{chat.phone || chat.chat_id}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
          {PreviewIcon ? <PreviewIcon className="h-3.5 w-3.5 shrink-0" /> : <MessageCircle className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{previewText}</span>
          {chat.unread_count > 0 && (
            <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-wa-primary px-1.5 text-[10px] font-bold text-white">
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </span>
          )}
        </div>

        {(chat.servicio_interes || chat.vendedor) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chat.servicio_interes && (
              <span className="max-w-full truncate rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-wa-primary-strong dark:bg-green-950/50 dark:text-wa-primary">
                {chat.servicio_interes}
              </span>
            )}
            {chat.vendedor && (
              <span className="flex max-w-full items-center gap-1 truncate rounded-md bg-wa-field px-2 py-1 text-[10px] text-gray-600 dark:bg-wa-active-dark dark:text-gray-300">
                <UserRound className="h-3 w-3 shrink-0" />
                <span className="truncate">{chat.vendedor}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-wa-border px-2.5 py-2 dark:border-wa-border-dark">
        <label className="sr-only" htmlFor={`stage-${chat.chat_id}`}>
          Etapa de {displayName(chat)}
        </label>
        <select
          id={`stage-${chat.chat_id}`}
          value={chat.stage}
          disabled={isMoving}
          onChange={(event) => {
            const stage = event.target.value
            if (isLeadStage(stage)) onMove(chat, stage)
          }}
          className="w-full rounded-md border-0 bg-transparent px-1 py-1 text-[11px] font-medium text-wa-muted outline-none hover:bg-wa-hover focus:ring-2 focus:ring-wa-primary disabled:cursor-wait dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
        >
          {LEAD_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              Mover a {LEAD_STAGE_META[stage].label}
            </option>
          ))}
        </select>
      </div>
    </article>
  )
}

interface KanbanColumnProps {
  stage: LeadStage
  search: string
  total: number
  initialPage: KanbanPage | undefined
  snapshotLoading: boolean
  snapshotError: boolean
  draggedChat: Chat | null
  movingIds: Set<string>
  selectedIds: Set<string>
  onToggleSelect: (chatId: string) => void
  onOpen: (chat: Chat) => void
  onDragStart: (chat: Chat) => void
  onDragEnd: () => void
  onMove: (chat: Chat, stage: LeadStage) => void
}

function KanbanColumn({
  stage,
  search,
  total,
  initialPage,
  snapshotLoading,
  snapshotError,
  draggedChat,
  movingIds,
  selectedIds,
  onToggleSelect,
  onOpen,
  onDragStart,
  onDragEnd,
  onMove,
}: KanbanColumnProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  const [extraPages, setExtraPages] = useState<KanbanPage[]>([])
  const loadNextPage = useLoadKanbanStage()
  useEffect(() => setExtraPages([]), [initialPage, search])
  const chats = [...(initialPage?.items ?? []), ...extraPages.flatMap((page) => page.items)]
  const lastPage = extraPages.at(-1) ?? initialPage
  const hasNextPage = lastPage?.has_more ?? false
  const meta = LEAD_STAGE_META[stage]

  function fetchNextPage() {
    loadNextPage.mutate(
      { stage, search, offset: chats.length },
      { onSuccess: (page) => setExtraPages((current) => [...current, page]) }
    )
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragOver(false)
    if (draggedChat && draggedChat.stage !== stage) onMove(draggedChat, stage)
  }

  return (
    <section
      onDragOver={(event) => {
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setIsDragOver(true)
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setIsDragOver(false)
      }}
      onDrop={handleDrop}
      className={`flex h-full w-[19rem] shrink-0 flex-col overflow-hidden rounded-2xl border bg-wa-field/80 transition-colors dark:bg-wa-panel-dark/70 ${
        isDragOver ? 'border-wa-primary bg-green-50/80 ring-2 ring-wa-primary/20 dark:bg-green-950/20' : 'border-wa-border dark:border-wa-border-dark'
      }`}
    >
      <header className={`flex items-center gap-2 border-t-4 ${meta.header} px-3.5 py-3`}>
        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-wa-text-dark">{meta.label}</h2>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-wa-muted shadow-sm dark:bg-wa-head-dark dark:text-wa-muted-dark">
          {total}
        </span>
      </header>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-3">
        {snapshotLoading && (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-wa-muted" /></div>
        )}
        {snapshotError && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="h-5 w-5" /> No se pudo cargar esta etapa
          </div>
        )}
        {!snapshotLoading && !snapshotError && chats.length === 0 && (
          <div className={`rounded-xl border border-dashed p-5 text-center text-xs ${isDragOver ? 'border-wa-primary text-wa-primary-strong' : 'border-gray-300 text-wa-muted dark:border-wa-border-dark dark:text-gray-600'}`}>
            {isDragOver ? 'Suelta aquí' : search ? 'Sin resultados' : 'Sin leads en esta etapa'}
          </div>
        )}
        {chats.map((chat) => (
          <KanbanCard
            key={chat.chat_id}
            chat={chat}
            isMoving={movingIds.has(chat.chat_id)}
            isSelected={selectedIds.has(chat.chat_id)}
            onToggleSelect={onToggleSelect}
            onOpen={onOpen}
            onDragStart={onDragStart}
            onDragEnd={onDragEnd}
            onMove={onMove}
          />
        ))}
        {hasNextPage && (
          <button
            onClick={() => fetchNextPage()}
            disabled={loadNextPage.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-wa-border bg-white py-2 text-xs font-medium text-wa-muted hover:bg-wa-hover disabled:cursor-wait dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
          >
            {loadNextPage.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            Cargar más
          </button>
        )}
      </div>
    </section>
  )
}

interface KanbanBoardProps {
  onOpenChat: (chat: Chat) => void
}

export function KanbanBoard({ onOpenChat }: KanbanBoardProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [draggedChat, setDraggedChat] = useState<Chat | null>(null)
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkError, setBulkError] = useState<string | null>(null)
  const { data: snapshot, isLoading: snapshotLoading, isError: snapshotError } = useKanbanSnapshot(debouncedSearch)
  const { data: tags = [] } = useTags()
  const { mutate: moveLead } = useMoveLeadStage()
  const { mutate: bulkMoveStage, isPending: isBulkMoving } = useBulkMoveStage()
  const { mutate: bulkAssignTag, isPending: isBulkTagging } = useBulkAssignTag()

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  function handleMove(chat: Chat, stage: LeadStage) {
    if (chat.stage === stage || movingIds.has(chat.chat_id)) return
    setMovingIds((current) => new Set(current).add(chat.chat_id))
    setDraggedChat(null)
    moveLead(
      { chatId: chat.chat_id, stage },
      {
        onSettled: () => {
          setMovingIds((current) => {
            const next = new Set(current)
            next.delete(chat.chat_id)
            return next
          })
        },
      }
    )
  }

  function toggleSelect(chatId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(chatId)) next.delete(chatId)
      else next.add(chatId)
      return next
    })
  }

  function describeBulkFailure(action: string, failed: string[]) {
    if (failed.length === 0) return null
    return `${failed.length} lead${failed.length === 1 ? '' : 's'} no se pud${failed.length === 1 ? 'o' : 'ieron'} ${action}.`
  }

  function handleBulkMove(stage: LeadStage) {
    setBulkError(null)
    bulkMoveStage(
      { chatIds: Array.from(selectedIds), stage },
      {
        onSuccess: (result) => {
          setBulkError(describeBulkFailure('mover', result.failed))
          setSelectedIds(new Set())
        },
        onError: () => setBulkError('No se pudo mover la selección.'),
      }
    )
  }

  function handleBulkTag(tagId: number) {
    setBulkError(null)
    bulkAssignTag(
      { chatIds: Array.from(selectedIds), tagId },
      {
        onSuccess: (result) => {
          setBulkError(describeBulkFailure('etiquetar', result.failed))
          setSelectedIds(new Set())
        },
        onError: () => setBulkError('No se pudo etiquetar la selección.'),
      }
    )
  }

  const isBulkBusy = isBulkMoving || isBulkTagging

  return (
    <main className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-wa-app dark:bg-wa-app-dark">
      <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-3 border-b border-wa-border bg-white px-5 py-3 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <div>
          <h1 className="text-base font-bold text-wa-text dark:text-wa-text-dark">Embudo comercial</h1>
          <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Arrastra cada lead o cambia su etapa desde la tarjeta.</p>
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar lead, servicio o mensaje..."
            className="h-9 w-full rounded-lg border border-wa-border bg-wa-hover pl-9 pr-3 text-sm text-gray-800 outline-none transition focus:border-wa-primary focus:ring-2 focus:ring-wa-primary/20 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-green-200 bg-green-50 px-5 py-2.5 dark:border-green-900 dark:bg-green-950/30">
          <span className="text-xs font-semibold text-green-800 dark:text-wa-primary">
            {selectedIds.size} seleccionado{selectedIds.size === 1 ? '' : 's'}
          </span>

          <select
            value=""
            disabled={isBulkBusy}
            onChange={(event) => {
              const stage = event.target.value
              if (isLeadStage(stage)) handleBulkMove(stage)
            }}
            className="rounded-md border border-wa-primary/40 bg-white px-2 py-1 text-xs text-gray-700 outline-none disabled:cursor-wait disabled:opacity-60 dark:border-green-800 dark:bg-wa-head-dark dark:text-wa-text-dark"
          >
            <option value="">Mover a...</option>
            {LEAD_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {LEAD_STAGE_META[stage].label}
              </option>
            ))}
          </select>

          {tags.length > 0 && (
            <div className="flex items-center gap-1">
              <TagIcon className="h-3.5 w-3.5 text-wa-primary-strong dark:text-wa-primary" />
              <select
                value=""
                disabled={isBulkBusy}
                onChange={(event) => {
                  const tagId = event.target.value
                  if (tagId) handleBulkTag(Number(tagId))
                }}
                className="rounded-md border border-wa-primary/40 bg-white px-2 py-1 text-xs text-gray-700 outline-none disabled:cursor-wait disabled:opacity-60 dark:border-green-800 dark:bg-wa-head-dark dark:text-wa-text-dark"
              >
                <option value="">Agregar etiqueta...</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {isBulkBusy && <Loader2 className="h-4 w-4 animate-spin text-wa-primary-strong dark:text-wa-primary" />}
          {bulkError && <span className="text-xs text-red-600 dark:text-red-400">{bulkError}</span>}

          <button
            type="button"
            onClick={() => {
              setSelectedIds(new Set())
              setBulkError(null)
            }}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-wa-muted hover:bg-white dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"
          >
            <X className="h-3.5 w-3.5" /> Cancelar
          </button>
        </div>
      )}

      <div className="flex min-h-0 min-w-0 w-full max-w-full flex-1 gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain p-4">
        {LEAD_STAGES.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            search={debouncedSearch}
            total={snapshot?.counts[stage] ?? 0}
            initialPage={snapshot?.stages[stage]}
            snapshotLoading={snapshotLoading}
            snapshotError={snapshotError}
            draggedChat={draggedChat}
            movingIds={movingIds}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onOpen={onOpenChat}
            onDragStart={setDraggedChat}
            onDragEnd={() => setDraggedChat(null)}
            onMove={handleMove}
          />
        ))}
      </div>
    </main>
  )
}
