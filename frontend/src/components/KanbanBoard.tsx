import { useEffect, useState, type DragEvent } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { AlertCircle, ArrowRight, BotOff, Check, GripVertical, Inbox, Loader2, MessageCircle, Search, Tag as TagIcon, UserRound, X } from 'lucide-react'
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
import { avatarInitial, displayName, isBotAttended } from '../utils/chat'
import { parseContent } from '../utils/message'
import { LostReasonDialog } from './LostReasonDialog'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Input'

// Puras y sin estado: viven en ámbito de módulo para no reconstruirse en
// cada render, lo que además rompía la memoización de los hijos.
function describeBulkFailure(action: string, failed: string[]) {
  if (failed.length === 0) return null
  return `${failed.length} lead${failed.length === 1 ? '' : 's'} no se pud${failed.length === 1 ? 'o' : 'ieron'} ${action}.`
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
  const preview = parseContent({ content: chat.last_message, message_type: chat.last_message_type })
  const PreviewIcon = preview.icon
  const previewText = preview.kind === 'location' ? preview.label : preview.text || preview.label || 'Sin mensajes'
  const accessibleSummary = `Abrir chat de ${displayName(chat)}. ${chat.phone || chat.chat_id}. ${previewText}.${chat.unread_count > 0 ? ` ${chat.unread_count} ${chat.unread_count === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}.` : ''}`

  return (
    <article
      draggable={!isMoving}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(chat.chat_id))
        onDragStart(chat)
      }}
      onDragEnd={onDragEnd}
      className={`group relative rounded-lg border bg-wa-panel dark:bg-wa-head-dark ${
        isSelected ? 'border-wa-primary-strong ring-2 ring-wa-primary-strong/30 dark:border-wa-primary' : 'border-wa-border dark:border-wa-border-dark'
      } ${
        isMoving ? 'opacity-50' : 'cursor-grab hover:border-wa-muted active:cursor-grabbing dark:hover:border-wa-muted-dark'
      }`}
    >
      <button
        type="button"
        onClick={() => onToggleSelect(chat.chat_id)}
        aria-label={isSelected ? `Deseleccionar ${displayName(chat)}` : `Seleccionar ${displayName(chat)}`}
        aria-pressed={isSelected}
        className="absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong"
      >
        <span className={`flex h-5 w-5 items-center justify-center rounded border ${isSelected ? 'border-wa-primary-strong bg-wa-primary-strong text-white' : 'border-wa-muted bg-wa-panel dark:border-wa-muted-dark dark:bg-wa-head-dark'}`}>
          {isSelected && <Check className="h-3 w-3" aria-hidden="true" />}
        </span>
      </button>
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
        className="w-full cursor-pointer py-3 pl-11 pr-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wa-primary-strong"
        aria-label={accessibleSummary}
      >
        <div className="flex items-start gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-primary-strong text-xs font-semibold text-white">
            {avatarInitial(chat)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-2">
              <p className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">{displayName(chat)}</p>
              <GripVertical className="h-4 w-4 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            </div>
            {(chat.con_especialista || chat.automatizacion_pausada) && (
              <div className="mt-1 flex flex-wrap gap-1">
                {chat.con_especialista && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
                    <UserRound className="h-2.5 w-2.5" /> Con especialista
                  </span>
                )}
                {chat.automatizacion_pausada && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                    <BotOff className="h-2.5 w-2.5" /> Bot pausado
                  </span>
                )}
              </div>
            )}
            <p className="mt-0.5 truncate text-xs text-wa-muted dark:text-wa-muted-dark">{chat.phone || chat.chat_id}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
          {PreviewIcon ? <PreviewIcon className="h-3.5 w-3.5 shrink-0" /> : <MessageCircle className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate">{previewText}</span>
          {chat.unread_count > 0 && (
            <span
              title={isBotAttended(chat) ? 'Un bot ya respondió — nadie del equipo vio el mensaje del cliente todavía' : undefined}
              className={`ml-auto flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white ${
                isBotAttended(chat) ? 'bg-amber-700' : 'bg-wa-primary-strong'
              }`}
            >
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </span>
          )}
        </div>

        {(chat.servicio_interes || chat.vendedor) && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {chat.servicio_interes && (
              <span className="max-w-full truncate rounded-md bg-wa-field px-2 py-1 text-xs font-medium text-wa-primary-strong dark:bg-wa-active-dark dark:text-wa-primary">
                {chat.servicio_interes}
              </span>
            )}
            {chat.vendedor && (
              <span className="flex max-w-full items-center gap-1 truncate rounded-md bg-wa-field px-2 py-1 text-xs text-wa-muted dark:bg-wa-active-dark dark:text-wa-muted-dark">
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
        <Select
          id={`stage-${chat.chat_id}`}
          value={chat.stage}
          disabled={isMoving}
          onChange={(event) => {
            const stage = event.target.value
            if (isLeadStage(stage)) onMove(chat, stage)
          }}
          className="w-full border-0 bg-transparent px-2 py-1 text-xs font-medium text-wa-text outline-none hover:bg-wa-hover focus:ring-2 focus:ring-wa-primary-strong disabled:cursor-wait dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
        >
          {LEAD_STAGES.map((stage) => (
            <option key={stage} value={stage}>
              Mover a {LEAD_STAGE_META[stage].label}
            </option>
          ))}
        </Select>
      </div>
    </article>
  )
}

interface KanbanColumnProps {
  stage: LeadStage
  search: string
  total: number
  initialPage: KanbanPage | undefined
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
  const { mutate: loadPage, isPending: isLoadingPage, isError: isPageError, reset: resetPage } = useLoadKanbanStage()
  useEffect(() => {
    setExtraPages([])
    resetPage()
  }, [initialPage, search, resetPage])
  const chats = [...(initialPage?.items ?? []), ...extraPages.flatMap((page) => page.items)]
  const lastPage = extraPages.at(-1) ?? initialPage
  const hasNextPage = lastPage?.has_more ?? false
  const meta = LEAD_STAGE_META[stage]

  function fetchNextPage() {
    loadPage(
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
      /* En móvil la columna ocupa casi todo el ancho y engancha al hacer
         scroll, para que se lea una etapa por vez en vez de tres cortadas. */
      aria-label={`${meta.label}, ${total} ${total === 1 ? 'lead' : 'leads'}`}
      className={`flex h-full w-[85vw] max-w-76 shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-wa-field sm:w-76 dark:bg-wa-panel-dark ${
        isDragOver ? 'border-wa-primary-strong ring-2 ring-wa-primary-strong/30' : 'border-wa-border dark:border-wa-border-dark'
      }`}
    >
      <header className={`flex min-h-14 items-center gap-2 border-t-4 border-b border-b-wa-border ${meta.header} px-3 py-2.5 dark:border-b-wa-border-dark`}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${meta.dot}`} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-wa-text dark:text-wa-text-dark">{meta.label}</h2>
        <span className="rounded-md bg-wa-panel px-2 py-0.5 text-xs font-semibold text-wa-text dark:bg-wa-head-dark dark:text-wa-text-dark">
          {total}
        </span>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {chats.length === 0 && (
          <div className={`rounded-lg border border-dashed px-3 py-5 text-center text-sm leading-5 ${isDragOver ? 'border-wa-primary-strong text-wa-primary-strong dark:text-wa-primary' : 'border-wa-border bg-wa-panel/60 text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark/50 dark:text-wa-muted-dark'}`}>
            {isDragOver ? 'Suelta el lead aquí' : search ? 'Sin coincidencias en esta etapa' : 'Mueve un lead a esta etapa'}
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
          <button type="button"
            onClick={() => fetchNextPage()}
            disabled={isLoadingPage}
            className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg border border-wa-border bg-wa-panel px-3 text-sm font-medium text-wa-text hover:bg-wa-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong disabled:cursor-wait dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
          >
            {isLoadingPage && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
            Cargar más
          </button>
        )}
        {isPageError && <p role="alert" className="text-center text-xs text-red-700 dark:text-red-300">No se cargaron más leads. Vuelve a intentarlo.</p>}
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
  // Movimiento a `perdido` esperando que el asesor escriba (o saltee) la razón.
  const [pendingLost, setPendingLost] = useState<
    { kind: 'single'; chat: Chat } | { kind: 'bulk'; count: number } | null
  >(null)
  const { data: snapshot, isLoading: snapshotLoading, isError: snapshotError, refetch } = useKanbanSnapshot(debouncedSearch)
  const { data: tags = [] } = useTags()
  const { mutate: moveLead } = useMoveLeadStage()
  const { mutate: bulkMoveStage, isPending: isBulkMoving } = useBulkMoveStage()
  const { mutate: bulkAssignTag, isPending: isBulkTagging } = useBulkAssignTag()

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  function handleMove(chat: Chat, stage: LeadStage, razonPerdido?: string | null) {
    if (chat.stage === stage || movingIds.has(chat.chat_id)) return
    // Antes de dar un lead por perdido se pide la razón (una sola vez: la
    // segunda pasada llega desde el diálogo con razonPerdido ya definido).
    if (stage === 'perdido' && razonPerdido === undefined) {
      setDraggedChat(null)
      setPendingLost({ kind: 'single', chat })
      return
    }
    setMovingIds((current) => new Set(current).add(chat.chat_id))
    setDraggedChat(null)
    moveLead(
      { chatId: chat.chat_id, stage, razonPerdido },
      {
        onError: () => toast.error('No se pudo cambiar la etapa. Inténtalo de nuevo.'),
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


  function handleBulkMove(stage: LeadStage, razonPerdido?: string | null) {
    if (stage === 'perdido' && razonPerdido === undefined) {
      setPendingLost({ kind: 'bulk', count: selectedIds.size })
      return
    }
    setBulkError(null)
    bulkMoveStage(
      { chatIds: Array.from(selectedIds), stage, razonPerdido },
      {
        onSuccess: (result) => {
          setBulkError(describeBulkFailure('mover', result.failed))
          setSelectedIds(new Set(result.failed))
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
          setSelectedIds(new Set(result.failed))
        },
        onError: () => setBulkError('No se pudo etiquetar la selección.'),
      }
    )
  }

  const isBulkBusy = isBulkMoving || isBulkTagging
  const totalLeads = snapshot ? LEAD_STAGES.reduce((count, stage) => count + snapshot.counts[stage], 0) : 0
  const boardDescription = snapshotLoading || snapshotError
    ? 'Consulta el avance de tus leads por etapa.'
    : totalLeads === 0
      ? debouncedSearch ? 'No hay leads que coincidan con tu búsqueda.' : 'Aquí verás tus leads organizados por etapa.'
      : `${totalLeads} ${totalLeads === 1 ? 'lead' : 'leads'} ${debouncedSearch ? 'en esta búsqueda' : 'en el embudo'}. Arrastra una tarjeta o usa su selector para cambiarla de etapa.`

  return (
    <main className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-wa-app dark:bg-wa-app-dark">
      <div className="flex w-full min-w-0 shrink-0 flex-wrap items-end gap-3 border-b border-wa-border bg-wa-panel px-4 py-4 sm:px-6 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-wa-text dark:text-wa-text-dark">Embudo comercial</h1>
          <p className="mt-1 text-sm leading-5 text-wa-muted dark:text-wa-muted-dark">{boardDescription}</p>
        </div>
        <div className="w-full sm:w-72">
          <label htmlFor="kanban-search" className="mb-1.5 block text-sm font-medium text-wa-text dark:text-wa-text-dark">Buscar leads</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" aria-hidden="true" />
            <Input
              id="kanban-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setSelectedIds(new Set())
                setBulkError(null)
              }}
              placeholder="Nombre, servicio o mensaje"
              className="h-11 border-wa-border pl-9 focus:ring-wa-primary-strong dark:border-wa-border-dark"
            />
          </div>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <div className="flex w-full min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-wa-border bg-wa-field px-4 py-2.5 sm:px-6 dark:border-wa-border-dark dark:bg-wa-head-dark">
          <span className="mr-1 text-sm font-semibold text-wa-text dark:text-wa-text-dark" role="status">
            {selectedIds.size} seleccionado{selectedIds.size === 1 ? '' : 's'}
          </span>

          <Select
            value=""
            disabled={isBulkBusy}
            aria-label={`Mover ${selectedIds.size} ${selectedIds.size === 1 ? 'lead' : 'leads'} a otra etapa`}
            onChange={(event) => {
              const stage = event.target.value
              if (isLeadStage(stage)) handleBulkMove(stage)
            }}
            className="h-10 w-auto min-w-40 border-wa-border bg-wa-panel text-sm focus:ring-wa-primary-strong disabled:cursor-wait disabled:opacity-60 dark:border-wa-border-dark dark:bg-wa-panel-dark"
          >
            <option value="">Mover a...</option>
            {LEAD_STAGES.map((stage) => (
              <option key={stage} value={stage}>
                {LEAD_STAGE_META[stage].label}
              </option>
            ))}
          </Select>

          {tags.length > 0 && (
            <div className="flex items-center gap-1">
              <TagIcon className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
              <Select
                value=""
                disabled={isBulkBusy}
                aria-label={`Agregar etiqueta a ${selectedIds.size} ${selectedIds.size === 1 ? 'lead' : 'leads'}`}
                onChange={(event) => {
                  const tagId = event.target.value
                  if (tagId) handleBulkTag(Number(tagId))
                }}
                className="h-10 w-auto min-w-44 border-wa-border bg-wa-panel text-sm focus:ring-wa-primary-strong disabled:cursor-wait disabled:opacity-60 dark:border-wa-border-dark dark:bg-wa-panel-dark"
              >
                <option value="">Agregar etiqueta...</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </Select>
            </div>
          )}

          {isBulkBusy && <span className="inline-flex items-center gap-2 text-sm text-wa-muted dark:text-wa-muted-dark" role="status"><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Aplicando cambios…</span>}
          {bulkError && <span role="alert" className="text-sm text-red-700 dark:text-red-300">{bulkError} La selección conserva los fallidos.</span>}

          <button
            type="button"
            onClick={() => {
              setSelectedIds(new Set())
              setBulkError(null)
            }}
            className="ml-auto flex min-h-10 items-center gap-1 rounded-md px-3 text-sm font-medium text-wa-text hover:bg-wa-panel focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong dark:text-wa-text-dark dark:hover:bg-wa-panel-dark"
          >
            <X className="h-4 w-4" aria-hidden="true" /> Cancelar selección
          </button>
        </div>
      )}

      {snapshotLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-wa-muted dark:text-wa-muted-dark" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Cargando embudo…
        </div>
      ) : snapshotError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-wa-panel p-6 text-center dark:bg-wa-panel-dark" role="alert">
            <AlertCircle className="mx-auto h-8 w-8 text-red-700 dark:text-red-300" aria-hidden="true" />
            <h2 className="mt-3 text-base font-semibold text-wa-text dark:text-wa-text-dark">No se pudo cargar el embudo</h2>
            <p className="mt-1 text-sm text-wa-muted dark:text-wa-muted-dark">Comprueba tu conexión y vuelve a intentarlo.</p>
            <Button variant="secondary" onClick={() => void refetch()} className="mt-4 h-10">Reintentar</Button>
          </div>
        </div>
      ) : totalLeads === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <div className="w-full max-w-md rounded-xl border border-wa-border bg-wa-panel px-6 py-10 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <Inbox className="mx-auto h-9 w-9 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-wa-text dark:text-wa-text-dark">{debouncedSearch ? 'No hay leads con esta búsqueda' : 'Aún no hay leads en el embudo'}</h2>
            <p className="mt-2 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">{debouncedSearch ? 'Prueba con otro nombre, servicio o mensaje.' : 'Los leads que registres desde Conversaciones aparecerán aquí para seguir su avance.'}</p>
            {debouncedSearch ? (
              <Button variant="secondary" onClick={() => { setSearch(''); setDebouncedSearch(''); setSelectedIds(new Set()); setBulkError(null) }} className="mt-5 h-10">Limpiar búsqueda</Button>
            ) : (
              <Link to="/" className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-wa-primary-strong px-4 text-sm font-semibold text-white hover:bg-wa-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong">Ir a Conversaciones <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            )}
          </div>
        </div>
      ) : (
        <>
          <p className="shrink-0 px-4 pt-2 text-xs text-wa-muted sm:px-6 dark:text-wa-muted-dark">Desplázate horizontalmente para ver las {LEAD_STAGES.length} etapas.</p>
          <div role="region" aria-label="Etapas del embudo comercial" tabIndex={0} className="flex min-h-0 min-w-0 w-full max-w-full flex-1 snap-x snap-mandatory gap-3 overflow-x-auto overflow-y-hidden overscroll-x-contain p-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong sm:snap-none sm:p-4">
            {LEAD_STAGES.map((stage) => (
              <KanbanColumn
                key={stage}
                stage={stage}
                search={debouncedSearch}
                total={snapshot?.counts[stage] ?? 0}
                initialPage={snapshot?.stages[stage]}
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
        </>
      )}

      {pendingLost && (
        <LostReasonDialog
          count={pendingLost.kind === 'bulk' ? pendingLost.count : 1}
          onCancel={() => setPendingLost(null)}
          onConfirm={(razon) => {
            const pending = pendingLost
            setPendingLost(null)
            if (pending.kind === 'single') handleMove(pending.chat, 'perdido', razon)
            else handleBulkMove('perdido', razon)
          }}
        />
      )}
    </main>
  )
}
