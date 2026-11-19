import { Check, GripVertical, Loader2, MessageCircle, UserRound, ZapOff } from 'lucide-react'
import { useEffect, useRef, useState, type DragEvent } from 'react'
import { Select } from '../../../../shared/ui/Input'
import { parseContent } from '../../../whatsapp/public/message'
import {
  STAGE_DOT_CLASS,
  STAGE_HEADER_CLASS,
  stageColorStyle,
  stageOptions,
  type LeadStageCatalog,
} from '../../domain/leadStageMeta'
import { useLoadKanbanStage, type KanbanPage } from '../../kanban-queries'
import type { Chat, LeadStage, LeadStageDefinition } from '../../types'
import { avatarInitial, displayName, isBotAttended } from '../../utils/chat'
import { setLeadDragPreview } from './dragPreview'
import { useDragAutoScroll } from '../../hooks/useDragAutoScroll'

// Vista "Tablero": las columnas en horizontal de siempre, que parte del equipo
// prefiere a la lista por etapas. Se conserva como era (salvo la imagen del
// arrastre, compartida con la lista) para que quien vuelva encuentre lo que conocía.

interface KanbanCardProps {
  chat: Chat
  catalog: LeadStageCatalog
  isMoving: boolean
  isSelected: boolean
  onToggleSelect: (chatId: string) => void
  onOpen: (chat: Chat) => void
  onDragStart: (chat: Chat) => void
  onDragEnd: () => void
  onMove: (chat: Chat, stage: LeadStage) => void
}

function KanbanCard({ chat, catalog, isMoving, isSelected, onToggleSelect, onOpen, onDragStart, onDragEnd, onMove }: KanbanCardProps) {
  const preview = parseContent({ content: chat.last_message, message_type: chat.last_message_type, message_subtype: chat.last_message_subtype })
  const PreviewIcon = preview.icon
  const previewText = preview.kind === 'location' ? preview.label : preview.text || preview.label || 'Sin mensajes'
  const accessibleSummary = `Abrir chat de ${displayName(chat)}. ${chat.phone || chat.chat_id}. ${previewText}.${chat.unread_count > 0 ? ` ${chat.unread_count} ${chat.unread_count === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}.` : ''}`

  const [isDragging, setIsDragging] = useState(false)

  return (
    <article
      draggable={!isMoving}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(chat.chat_id))
        // Misma pastilla que en la lista: la captura de la tarjeta entera
        // tapaba las columnas a las que se quería soltar.
        setLeadDragPreview(event, displayName(chat), avatarInitial(chat))
        setIsDragging(true)
        onDragStart(chat)
      }}
      onDragEnd={() => {
        setIsDragging(false)
        onDragEnd()
      }}
      className={`group relative rounded-lg border bg-wa-panel dark:bg-wa-head-dark ${
        isSelected ? 'border-wa-primary-strong ring-2 ring-wa-primary-strong/30 dark:border-wa-primary' : 'border-wa-border dark:border-wa-border-dark'
      } ${
        isMoving || isDragging ? 'opacity-50' : 'cursor-grab hover:border-wa-muted active:cursor-grabbing dark:hover:border-wa-muted-dark'
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
                    <ZapOff className="h-2.5 w-2.5" /> Sin automatizaciones nuevas
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
          onChange={(event) => onMove(chat, event.target.value)}
          className="w-full border-0 bg-transparent px-2 py-1 text-xs font-medium text-wa-text outline-none hover:bg-wa-hover focus:ring-2 focus:ring-wa-primary-strong disabled:cursor-wait dark:text-wa-text-dark dark:hover:bg-wa-active-dark"
        >
          {stageOptions(catalog, chat.stage).map((stage) => (
            <option key={stage.key} value={stage.key} disabled={!stage.is_active}>
              {stage.is_active ? `Mover a ${stage.name}` : `${stage.name} (inactiva)`}
            </option>
          ))}
        </Select>
      </div>
    </article>
  )
}

interface KanbanColumnProps {
  stage: LeadStageDefinition
  catalog: LeadStageCatalog
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

export function KanbanColumn({
  stage,
  catalog,
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
  const listRef = useRef<HTMLDivElement>(null)
  useDragAutoScroll(listRef, 'y', draggedChat !== null)
  const [extraPages, setExtraPages] = useState<KanbanPage[]>([])
  const { mutate: loadPage, isPending: isLoadingPage, isError: isPageError, reset: resetPage } = useLoadKanbanStage()
  useEffect(() => {
    setExtraPages([])
    resetPage()
  }, [initialPage, search, resetPage])
  const chats = [...(initialPage?.items ?? []), ...extraPages.flatMap((page) => page.items)]
  const lastPage = extraPages.at(-1) ?? initialPage
  const hasNextPage = lastPage?.has_more ?? false

  function fetchNextPage() {
    loadPage(
      { stage: stage.key, search, offset: chats.length },
      { onSuccess: (page) => setExtraPages((current) => [...current, page]) }
    )
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault()
    setIsDragOver(false)
    // Una etapa desactivada sigue mostrando sus leads, pero no recibe nuevos.
    if (draggedChat && draggedChat.stage !== stage.key && stage.is_active) onMove(draggedChat, stage.key)
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
      aria-label={`${stage.name}${stage.is_active ? '' : ' (inactiva)'}, ${total} ${total === 1 ? 'lead' : 'leads'}`}
      className={`flex h-full w-[85vw] max-w-76 shrink-0 snap-start flex-col overflow-hidden rounded-xl border bg-wa-field sm:w-76 dark:bg-wa-panel-dark ${
        isDragOver ? 'border-wa-primary-strong ring-2 ring-wa-primary-strong/30' : 'border-wa-border dark:border-wa-border-dark'
      }`}
    >
      <header style={stageColorStyle(stage.color)} className={`flex min-h-14 items-center gap-2 border-t-4 border-b border-b-wa-border ${STAGE_HEADER_CLASS} px-3 py-2.5 dark:border-b-wa-border-dark`}>
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_DOT_CLASS}`} aria-hidden="true" />
        <h2 className="min-w-0 flex-1 text-sm font-semibold leading-5 text-wa-text dark:text-wa-text-dark">
          {stage.name}
          {!stage.is_active && <span className="ml-1.5 text-xs font-normal text-wa-muted dark:text-wa-muted-dark">(inactiva)</span>}
        </h2>
        <span className="rounded-md bg-wa-panel px-2 py-0.5 text-xs font-semibold text-wa-text dark:bg-wa-head-dark dark:text-wa-text-dark">
          {total}
        </span>
      </header>

      <div ref={listRef} className="flex-1 space-y-2 overflow-y-auto p-2.5">
        {chats.length === 0 && (
          <div className={`rounded-lg border border-dashed px-3 py-5 text-center text-sm leading-5 ${isDragOver ? 'border-wa-primary-strong text-wa-primary-strong dark:text-wa-primary' : 'border-wa-border bg-wa-panel/60 text-wa-muted dark:border-wa-border-dark dark:bg-wa-head-dark/50 dark:text-wa-muted-dark'}`}>
            {isDragOver ? (stage.is_active ? 'Suelta el lead aquí' : 'Esta etapa está desactivada') : search ? 'Sin coincidencias en esta etapa' : 'Mueve un lead a esta etapa'}
          </div>
        )}
        {chats.map((chat) => (
          <KanbanCard
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
