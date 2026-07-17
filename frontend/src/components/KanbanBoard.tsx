import { useEffect, useState, type DragEvent } from 'react'
import { AlertCircle, Check, GripVertical, Loader2, MessageCircle, Search, Tag as TagIcon, UserRound, X } from 'lucide-react'
import type { Chat, LeadStage } from '../types'
import { isLeadStage, LEAD_STAGES } from '../types'
import { useBulkAssignTag, useBulkMoveStage, useKanbanCounts, useKanbanStage, useMoveLeadStage } from '../hooks/useKanban'
import { useTags } from '../hooks/useLeadMeta'
import { avatarInitial, displayName } from '../utils/chat'
import { parseContent } from '../utils/message'

const STAGE_META: Record<LeadStage, { label: string; dot: string; header: string }> = {
  nuevo: { label: 'Nuevo', dot: 'bg-sky-500', header: 'border-sky-400' },
  calificacion: { label: 'Calificación', dot: 'bg-indigo-500', header: 'border-indigo-400' },
  cotizacion: { label: 'Cotización', dot: 'bg-violet-500', header: 'border-violet-400' },
  objecion: { label: 'Objeción', dot: 'bg-amber-500', header: 'border-amber-400' },
  cierre: { label: 'Cierre', dot: 'bg-orange-500', header: 'border-orange-400' },
  agendado: { label: 'Agendado', dot: 'bg-cyan-500', header: 'border-cyan-400' },
  postventa: { label: 'Postventa', dot: 'bg-emerald-500', header: 'border-emerald-400' },
  sin_respuesta: { label: 'Sin respuesta', dot: 'bg-slate-500', header: 'border-slate-400' },
  reactivacion: { label: 'Reactivación', dot: 'bg-fuchsia-500', header: 'border-fuchsia-400' },
  perdido: { label: 'Perdido', dot: 'bg-rose-500', header: 'border-rose-400' },
}

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
      className={`group rounded-xl border bg-white shadow-sm transition-all dark:bg-gray-800 ${
        isSelected ? 'border-green-500 ring-2 ring-green-500/30 dark:border-green-500' : 'border-gray-200 dark:border-gray-700'
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
                ? 'border-green-600 bg-green-600 text-white'
                : 'border-gray-300 bg-white opacity-0 group-hover:opacity-100 dark:border-gray-600 dark:bg-gray-700'
            }`}
          >
            {isSelected && <Check className="h-3 w-3" />}
          </button>
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-green-500 to-green-600 text-xs font-semibold text-white">
            {avatarInitial(chat)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">{displayName(chat)}</p>
              <GripVertical className="h-4 w-4 shrink-0 text-gray-300 group-hover:text-gray-500 dark:text-gray-600" />
            </div>
            <p className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">{chat.phone || chat.chat_id}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
          {PreviewIcon ? <PreviewIcon className="h-3.5 w-3.5 shrink-0" /> : <MessageCircle className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{previewText}</span>
          {chat.unread_count > 0 && (
            <span className="ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-green-600 px-1.5 text-[10px] font-bold text-white">
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </span>
          )}
        </div>

        {(chat.servicio_interes || chat.vendedor) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chat.servicio_interes && (
              <span className="max-w-full truncate rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 dark:bg-green-950/50 dark:text-green-400">
                {chat.servicio_interes}
              </span>
            )}
            {chat.vendedor && (
              <span className="flex max-w-full items-center gap-1 truncate rounded-md bg-gray-100 px-2 py-1 text-[10px] text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                <UserRound className="h-3 w-3 shrink-0" />
                <span className="truncate">{chat.vendedor}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 px-2.5 py-2 dark:border-gray-700">
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
          className="w-full rounded-md border-0 bg-transparent px-1 py-1 text-[11px] font-medium text-gray-500 outline-none hover:bg-gray-50 focus:ring-2 focus:ring-green-500 disabled:cursor-wait dark:text-gray-400 dark:hover:bg-gray-700"
        >
          {LEAD_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              Mover a {STAGE_META[stage].label}
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
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useKanbanStage(stage, search)
  const chats = data?.pages.flatMap((page) => page.items) ?? []
  const meta = STAGE_META[stage]

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
      className={`flex h-full w-[19rem] shrink-0 flex-col overflow-hidden rounded-2xl border bg-gray-100/80 transition-colors dark:bg-gray-900/70 ${
        isDragOver ? 'border-green-500 bg-green-50/80 ring-2 ring-green-500/20 dark:bg-green-950/20' : 'border-gray-200 dark:border-gray-800'
      }`}
    >
      <header className={`flex items-center gap-2 border-t-4 ${meta.header} px-3.5 py-3`}>
        <span className={`h-2.5 w-2.5 rounded-full ${meta.dot}`} />
        <h2 className="text-xs font-bold uppercase tracking-wide text-gray-700 dark:text-gray-200">{meta.label}</h2>
        <span className="ml-auto rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-gray-500 shadow-sm dark:bg-gray-800 dark:text-gray-400">
          {total}
        </span>
      </header>

      <div className="flex-1 space-y-2.5 overflow-y-auto px-2.5 pb-3">
        {isLoading && (
          <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
        )}
        {isError && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-center text-xs text-red-600 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400">
            <AlertCircle className="h-5 w-5" /> No se pudo cargar esta etapa
          </div>
        )}
        {!isLoading && !isError && chats.length === 0 && (
          <div className={`rounded-xl border border-dashed p-5 text-center text-xs ${isDragOver ? 'border-green-400 text-green-600' : 'border-gray-300 text-gray-400 dark:border-gray-700 dark:text-gray-600'}`}>
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
            disabled={isFetchingNextPage}
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 bg-white py-2 text-xs font-medium text-gray-500 hover:bg-gray-50 disabled:cursor-wait dark:border-gray-700 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
  const { data: counts } = useKanbanCounts(debouncedSearch)
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
    <main className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-gray-950">
      <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-5 py-3 dark:border-gray-800 dark:bg-gray-900">
        <div>
          <h1 className="text-base font-bold text-gray-900 dark:text-gray-100">Embudo comercial</h1>
          <p className="text-xs text-gray-400 dark:text-gray-500">Arrastra cada lead o cambia su etapa desde la tarjeta.</p>
        </div>
        <div className="relative ml-auto w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar lead, servicio o mensaje..."
            className="h-9 w-full rounded-lg border border-gray-200 bg-gray-50 pl-9 pr-3 text-sm text-gray-800 outline-none transition focus:border-green-500 focus:ring-2 focus:ring-green-500/20 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-green-200 bg-green-50 px-5 py-2.5 dark:border-green-900 dark:bg-green-950/30">
          <span className="text-xs font-semibold text-green-800 dark:text-green-400">
            {selectedIds.size} seleccionado{selectedIds.size === 1 ? '' : 's'}
          </span>

          <select
            value=""
            disabled={isBulkBusy}
            onChange={(event) => {
              const stage = event.target.value
              if (isLeadStage(stage)) handleBulkMove(stage)
            }}
            className="rounded-md border border-green-300 bg-white px-2 py-1 text-xs text-gray-700 outline-none disabled:cursor-wait disabled:opacity-60 dark:border-green-800 dark:bg-gray-800 dark:text-gray-200"
          >
            <option value="">Mover a...</option>
            {LEAD_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {STAGE_META[stage].label}
              </option>
            ))}
          </select>

          {tags.length > 0 && (
            <div className="flex items-center gap-1">
              <TagIcon className="h-3.5 w-3.5 text-green-700 dark:text-green-500" />
              <select
                value=""
                disabled={isBulkBusy}
                onChange={(event) => {
                  const tagId = event.target.value
                  if (tagId) handleBulkTag(Number(tagId))
                }}
                className="rounded-md border border-green-300 bg-white px-2 py-1 text-xs text-gray-700 outline-none disabled:cursor-wait disabled:opacity-60 dark:border-green-800 dark:bg-gray-800 dark:text-gray-200"
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

          {isBulkBusy && <Loader2 className="h-4 w-4 animate-spin text-green-600 dark:text-green-500" />}
          {bulkError && <span className="text-xs text-red-600 dark:text-red-400">{bulkError}</span>}

          <button
            type="button"
            onClick={() => {
              setSelectedIds(new Set())
              setBulkError(null)
            }}
            className="ml-auto flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-white dark:text-gray-400 dark:hover:bg-gray-800"
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
            total={counts?.[stage] ?? 0}
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
