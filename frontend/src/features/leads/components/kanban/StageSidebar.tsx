import { useState, type DragEvent } from 'react'
import { STAGE_BADGE_CLASS, STAGE_DOT_CLASS, stageColorStyle } from '../../domain/leadStageMeta'
import type { Chat, LeadStage, LeadStageDefinition } from '../../types'

interface StageSidebarProps {
  stages: LeadStageDefinition[]
  counts: Record<string, number>
  selected: LeadStage
  draggedChat: Chat | null
  onSelect: (stage: LeadStage) => void
  onDropChat: (chat: Chat, stage: LeadStage) => void
}

interface StageItemProps {
  stage: LeadStageDefinition
  total: number
  isSelected: boolean
  draggedChat: Chat | null
  compact: boolean
  onSelect: (stage: LeadStage) => void
  onDropChat: (chat: Chat, stage: LeadStage) => void
}

function StageItem({ stage, total, isSelected, draggedChat, compact, onSelect, onDropChat }: StageItemProps) {
  const [isDragOver, setIsDragOver] = useState(false)
  // Una etapa desactivada sigue mostrando sus leads, pero no recibe nuevos.
  const acceptsDrop = draggedChat !== null && draggedChat.stage !== stage.key && stage.is_active

  function handleDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault()
    setIsDragOver(false)
    if (draggedChat && acceptsDrop) onDropChat(draggedChat, stage.key)
  }

  const label = `${stage.name}${stage.is_active ? '' : ' (inactiva)'}, ${total} ${total === 1 ? 'lead' : 'leads'}`
  const dropClass = isDragOver && acceptsDrop ? 'ring-2 ring-wa-primary-strong bg-wa-primary-strong/10' : ''
  const stateClass = isSelected
    ? 'bg-wa-active text-wa-text dark:bg-wa-active-dark dark:text-wa-text-dark'
    : 'text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-hover-dark'

  return (
    <button
      type="button"
      style={stageColorStyle(stage.color)}
      onClick={() => onSelect(stage.key)}
      onDragOver={(event) => {
        if (!acceptsDrop) return
        event.preventDefault()
        event.dataTransfer.dropEffect = 'move'
        setIsDragOver(true)
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      aria-current={isSelected ? 'true' : undefined}
      aria-label={label}
      className={`group relative flex shrink-0 items-center gap-2.5 rounded-lg text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong ${
        compact ? 'min-h-9 border border-wa-border px-3 dark:border-wa-border-dark' : 'min-h-10 w-full px-3 py-1.5'
      } ${stateClass} ${dropClass}`}
    >
      {!compact && isSelected && <span className={`absolute inset-y-2 left-0 w-0.5 rounded-full ${STAGE_DOT_CLASS}`} aria-hidden="true" />}
      <span className={`h-2 w-2 shrink-0 rounded-full ${STAGE_DOT_CLASS} ${total === 0 && !isSelected ? 'opacity-40' : ''}`} aria-hidden="true" />
      <span
        className={`min-w-0 flex-1 truncate ${isSelected ? 'font-semibold' : 'font-medium'} ${
          !stage.is_active || (total === 0 && !isSelected) ? 'text-wa-muted dark:text-wa-muted-dark' : ''
        }`}
      >
        {stage.name}
        {!stage.is_active && <span className="ml-1 text-xs font-normal">(inactiva)</span>}
      </span>
      {/* El conteo toma el color de la etapa solo en la elegida: así resalta
          dónde estás sin convertir la lista en un arcoíris. */}
      <span
        className={`min-w-6 shrink-0 rounded-full px-1.5 py-0.5 text-center text-xs font-semibold tabular-nums ${
          isSelected
            ? STAGE_BADGE_CLASS
            : total === 0
              ? 'text-wa-muted dark:text-wa-muted-dark'
              : 'bg-wa-field text-wa-text dark:bg-wa-field-dark dark:text-wa-text-dark'
        }`}
      >
        {total}
      </span>
    </button>
  )
}

/** Etapas del embudo como índice: en escritorio, columna fija a la izquierda
 *  agrupada en "En curso" y "Cerradas"; en celular, una fila de chips. */
export function StageSidebar({ stages, counts, selected, draggedChat, onSelect, onDropChat }: StageSidebarProps) {
  const open = stages.filter((stage) => stage.kind === 'open')
  const closed = stages.filter((stage) => stage.kind !== 'open')
  const groups = [
    { title: 'En curso', items: open },
    { title: 'Cerradas', items: closed },
  ].filter((group) => group.items.length > 0)

  const renderItem = (stage: LeadStageDefinition, compact: boolean) => (
    <StageItem
      key={stage.key}
      stage={stage}
      total={counts[stage.key] ?? 0}
      isSelected={stage.key === selected}
      draggedChat={draggedChat}
      compact={compact}
      onSelect={onSelect}
      onDropChat={onDropChat}
    />
  )

  return (
    <>
      <nav aria-label="Etapas del embudo" className="flex shrink-0 gap-2 overflow-x-auto border-b border-wa-border bg-wa-panel px-4 py-2 md:hidden dark:border-wa-border-dark dark:bg-wa-panel-dark">
        {stages.map((stage) => renderItem(stage, true))}
      </nav>
      <nav aria-label="Etapas del embudo" className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-wa-border bg-wa-panel px-2 py-3 md:flex lg:w-64 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        {groups.map((group) => (
          <div key={group.title} className="mb-3 border-b border-wa-border pb-3 last:mb-0 last:border-b-0 last:pb-0 dark:border-wa-border-dark">
            <h2 className="mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider text-wa-muted dark:text-wa-muted-dark">{group.title}</h2>
            <div className="space-y-0.5">{group.items.map((stage) => renderItem(stage, false))}</div>
          </div>
        ))}
        {draggedChat && <p className="mt-auto px-3 pt-3 text-xs text-wa-muted dark:text-wa-muted-dark">Suelta el lead sobre una etapa para moverlo.</p>}
      </nav>
    </>
  )
}
