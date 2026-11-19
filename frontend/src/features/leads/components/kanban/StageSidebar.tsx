import { useState, type DragEvent } from 'react'
import { STAGE_DOT_CLASS, stageColorStyle } from '../../domain/leadStageMeta'
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
  maxTotal: number
  isSelected: boolean
  draggedChat: Chat | null
  compact: boolean
  onSelect: (stage: LeadStage) => void
  onDropChat: (chat: Chat, stage: LeadStage) => void
}

function StageItem({ stage, total, maxTotal, isSelected, draggedChat, compact, onSelect, onDropChat }: StageItemProps) {
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
        compact ? 'min-h-10 border border-wa-border px-3 dark:border-wa-border-dark' : 'min-h-11 w-full px-3 py-2'
      } ${stateClass} ${dropClass}`}
    >
      {!compact && isSelected && <span className={`absolute inset-y-1.5 left-0 w-1 rounded-r-full ${STAGE_DOT_CLASS}`} aria-hidden="true" />}
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${STAGE_DOT_CLASS}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className={`block truncate ${isSelected ? 'font-semibold' : 'font-medium'} ${stage.is_active ? '' : 'text-wa-muted dark:text-wa-muted-dark'}`}>
          {stage.name}
          {!stage.is_active && <span className="ml-1 text-xs font-normal">(inactiva)</span>}
        </span>
        {/* La barra da la forma del embudo sin leer números: dónde se acumulan
            los leads salta a la vista al recorrer la lista. */}
        {!compact && (
          <span className="mt-1 block h-1 overflow-hidden rounded-full bg-wa-border dark:bg-wa-border-dark" aria-hidden="true">
            <span className={`block h-full rounded-full ${STAGE_DOT_CLASS} opacity-70`} style={{ width: `${maxTotal > 0 ? Math.max((total / maxTotal) * 100, total > 0 ? 4 : 0) : 0}%` }} />
          </span>
        )}
      </span>
      <span className={`shrink-0 tabular-nums text-xs font-semibold ${total === 0 ? 'text-wa-muted dark:text-wa-muted-dark' : ''}`}>{total}</span>
    </button>
  )
}

/** Etapas del embudo como índice: en escritorio, columna fija a la izquierda
 *  agrupada en "En curso" y "Cerradas"; en celular, una fila de chips. */
export function StageSidebar({ stages, counts, selected, draggedChat, onSelect, onDropChat }: StageSidebarProps) {
  const maxTotal = Math.max(0, ...stages.map((stage) => counts[stage.key] ?? 0))
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
      maxTotal={maxTotal}
      isSelected={stage.key === selected}
      draggedChat={draggedChat}
      compact={compact}
      onSelect={onSelect}
      onDropChat={onDropChat}
    />
  )

  return (
    <>
      <nav aria-label="Etapas del embudo" className="flex shrink-0 gap-2 overflow-x-auto border-b border-wa-border bg-wa-panel px-4 py-2.5 md:hidden dark:border-wa-border-dark dark:bg-wa-panel-dark">
        {stages.map((stage) => renderItem(stage, true))}
      </nav>
      <nav aria-label="Etapas del embudo" className="hidden w-64 shrink-0 flex-col overflow-y-auto border-r border-wa-border bg-wa-panel p-3 md:flex lg:w-72 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        {groups.map((group) => (
          <div key={group.title} className="mb-4 last:mb-0">
            <h2 className="mb-1.5 px-3 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">{group.title}</h2>
            <div className="space-y-0.5">{group.items.map((stage) => renderItem(stage, false))}</div>
          </div>
        ))}
        {draggedChat && <p className="mt-auto px-3 pt-3 text-xs text-wa-muted dark:text-wa-muted-dark">Suelta el lead sobre una etapa para moverlo.</p>}
      </nav>
    </>
  )
}
