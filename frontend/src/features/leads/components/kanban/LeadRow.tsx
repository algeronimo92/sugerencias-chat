import { Check, GripVertical, MessageCircle, UserRound, ZapOff } from 'lucide-react'
import { Select } from '../../../../shared/ui/Input'
import { parseContent } from '../../../whatsapp/public/message'
import { stageOptions, type LeadStageCatalog } from '../../domain/leadStageMeta'
import type { Chat, LeadStage } from '../../types'
import { avatarInitial, displayName, formatElapsedShort, isBotAttended } from '../../utils/chat'

interface LeadRowProps {
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

/** Un lead en la lista de su etapa: se lee en una línea como un chat, se abre
 *  con un click y se cambia de etapa con el selector o arrastrándolo a la
 *  lista de etapas. */
export function LeadRow({ chat, catalog, isMoving, isSelected, onToggleSelect, onOpen, onDragStart, onDragEnd, onMove }: LeadRowProps) {
  const preview = parseContent({ content: chat.last_message, message_type: chat.last_message_type, message_subtype: chat.last_message_subtype })
  const PreviewIcon = preview.icon ?? MessageCircle
  const previewText = preview.kind === 'location' ? preview.label : preview.text || preview.label || 'Sin mensajes'
  const name = displayName(chat)
  const elapsed = chat.timestamp ? formatElapsedShort(Date.now() - new Date(chat.timestamp).getTime()) : null
  const botAttended = isBotAttended(chat)
  const accessibleSummary = `Abrir chat de ${name}. ${chat.phone || chat.chat_id}. ${previewText}.${chat.unread_count > 0 ? ` ${chat.unread_count} ${chat.unread_count === 1 ? 'mensaje sin leer' : 'mensajes sin leer'}.` : ''}`

  return (
    <li
      draggable={!isMoving}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'move'
        event.dataTransfer.setData('text/plain', String(chat.chat_id))
        onDragStart(chat)
      }}
      onDragEnd={onDragEnd}
      className={`group flex items-center gap-1 border-b border-wa-border last:border-b-0 dark:border-wa-border-dark ${
        isSelected ? 'bg-wa-primary-strong/5 dark:bg-wa-primary/10' : 'hover:bg-wa-hover dark:hover:bg-wa-hover-dark'
      } ${isMoving ? 'opacity-50' : ''}`}
    >
      <GripVertical className="ml-1 hidden h-4 w-4 shrink-0 cursor-grab text-wa-muted opacity-0 group-hover:opacity-100 md:block dark:text-wa-muted-dark" aria-hidden="true" />
      <button
        type="button"
        onClick={() => onToggleSelect(chat.chat_id)}
        aria-label={isSelected ? `Deseleccionar ${name}` : `Seleccionar ${name}`}
        aria-pressed={isSelected}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong"
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
        aria-label={accessibleSummary}
        className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-3 pr-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wa-primary-strong"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-primary-strong text-sm font-semibold text-white">{avatarInitial(chat)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className={`truncate text-sm text-wa-text dark:text-wa-text-dark ${chat.unread_count > 0 ? 'font-bold' : 'font-semibold'}`}>{name}</p>
            {chat.con_especialista && (
              <span title="Con especialista" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-purple-100 px-1.5 py-0.5 text-xs font-medium text-purple-700 dark:bg-purple-950/50 dark:text-purple-300">
                <UserRound className="h-3 w-3" aria-hidden="true" /><span className="hidden xl:inline">Con especialista</span>
              </span>
            )}
            {chat.automatizacion_pausada && (
              <span title="Sin automatizaciones nuevas" className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950/50 dark:text-amber-300">
                <ZapOff className="h-3 w-3" aria-hidden="true" /><span className="hidden xl:inline">Sin automatizaciones</span>
              </span>
            )}
          </div>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
            <PreviewIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{previewText}</span>
          </p>
        </div>

        <div className="hidden w-44 shrink-0 flex-col items-start gap-1 lg:flex">
          {chat.servicio_interes && <span className="max-w-full truncate rounded-md bg-wa-field px-2 py-0.5 text-xs font-medium text-wa-primary-strong dark:bg-wa-active-dark dark:text-wa-primary">{chat.servicio_interes}</span>}
          {chat.vendedor && (
            <span className="flex max-w-full items-center gap-1 text-xs text-wa-muted dark:text-wa-muted-dark">
              <UserRound className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{chat.vendedor}</span>
            </span>
          )}
        </div>

        <div className="flex w-12 shrink-0 flex-col items-end gap-1">
          {elapsed && <span className="text-xs tabular-nums text-wa-muted dark:text-wa-muted-dark" title={chat.timestamp ? new Date(chat.timestamp).toLocaleString() : undefined}>{elapsed}</span>}
          {chat.unread_count > 0 && (
            <span
              title={botAttended ? 'Un bot ya respondió — nadie del equipo vio el mensaje del cliente todavía' : undefined}
              className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold text-white ${botAttended ? 'bg-amber-700' : 'bg-wa-primary-strong'}`}
            >
              {chat.unread_count > 99 ? '99+' : chat.unread_count}
            </span>
          )}
        </div>
      </div>

      <div className="hidden w-44 shrink-0 pr-3 sm:block">
        <label className="sr-only" htmlFor={`stage-${chat.chat_id}`}>Etapa de {name}</label>
        <Select
          id={`stage-${chat.chat_id}`}
          value={chat.stage}
          disabled={isMoving}
          onChange={(event) => onMove(chat, event.target.value)}
          className="h-9 w-full border-wa-border bg-wa-panel px-2 text-xs font-medium focus:ring-wa-primary-strong disabled:cursor-wait dark:border-wa-border-dark dark:bg-wa-panel-dark"
        >
          {stageOptions(catalog, chat.stage).map((stage) => (
            <option key={stage.key} value={stage.key} disabled={!stage.is_active}>
              {stage.key === chat.stage ? stage.name : stage.is_active ? `Mover a ${stage.name}` : `${stage.name} (inactiva)`}
            </option>
          ))}
        </Select>
      </div>
    </li>
  )
}
