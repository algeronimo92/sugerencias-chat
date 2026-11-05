import { GripVertical, X } from 'lucide-react'
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import { cn } from '../../../shared/utils/cn'
import type { Piece } from '../domain/eventTemplate'

export type MoveDirection = 'left' | 'right' | 'up' | 'down'

interface Props {
  label: string
  pieces: Piece[]
  fieldLabels: Map<string, string>
  customKeys: Set<string>
  /** Índice donde caería lo que se está arrastrando, si es en esta zona. */
  dropIndex: number | null
  active: boolean
  focusId: string | null
  placeholder: string
  actions?: ReactNode
  onActivate: () => void
  onDragStartPiece: (index: number, event: DragEvent) => void
  onDragOverIndex: (index: number) => void
  onDrop: (index: number) => void
  onDragEnd: () => void
  onRemove: (index: number) => void
  onTextChange: (index: number, text: string) => void
  onMove: (index: number, direction: MoveDirection) => void
}

const KEY_DIRECTIONS: Record<string, MoveDirection> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
}

function DropMarker() {
  return <span aria-hidden="true" className="h-6 w-0.5 shrink-0 rounded-full bg-wa-primary" />
}

/** Una línea del armador: recibe piezas arrastradas y deja reordenarlas.
 *  Con teclado, Alt + flechas mueve la pieza enfocada y Supr la quita. */
export function EventTemplateZone({
  label, pieces, fieldLabels, customKeys, dropIndex, active, focusId, placeholder, actions,
  onActivate, onDragStartPiece, onDragOverIndex, onDrop, onDragEnd, onRemove, onTextChange, onMove,
}: Props) {
  const overPiece = (index: number) => (event: DragEvent<HTMLElement>) => {
    event.preventDefault()
    event.stopPropagation()
    const box = event.currentTarget.getBoundingClientRect()
    onDragOverIndex(event.clientX < box.left + box.width / 2 ? index : index + 1)
  }
  const dropOnPiece = (event: DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    onDrop(dropIndex ?? pieces.length)
  }
  const keyDown = (index: number, isText: boolean) => (event: KeyboardEvent) => {
    const direction = KEY_DIRECTIONS[event.key]
    if (direction && event.altKey) {
      event.preventDefault()
      onMove(index, direction)
    } else if (!isText && (event.key === 'Delete' || event.key === 'Backspace')) {
      event.preventDefault()
      onRemove(index)
    }
  }

  return (
    <div className="flex items-start gap-1.5">
      <div
        role="group"
        aria-label={label}
        onClick={onActivate}
        onFocus={onActivate}
        onDragOver={(event) => {
          event.preventDefault()
          if (event.target === event.currentTarget) onDragOverIndex(pieces.length)
        }}
        onDrop={(event) => {
          event.preventDefault()
          onDrop(dropIndex ?? pieces.length)
        }}
        className={cn(
          'flex min-h-9 flex-1 flex-wrap items-center gap-1 rounded-lg border border-dashed px-1.5 py-1 transition-colors',
          active
            ? 'border-wa-primary/70 bg-wa-primary/5'
            : 'border-wa-border bg-wa-hover/40 dark:border-wa-border-dark dark:bg-wa-head-dark/40',
          dropIndex !== null && 'border-wa-primary bg-wa-primary/10',
        )}
      >
        {pieces.length === 0 && dropIndex === null && (
          <span className="pointer-events-none px-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">{placeholder}</span>
        )}
        {pieces.map((piece, index) => {
          const isText = piece.kind === 'text'
          const isCustom = !isText && customKeys.has(piece.key)
          const name = isText ? `Texto "${piece.text}"` : fieldLabels.get(piece.key) ?? piece.key
          return (
            <span key={piece.id} className="contents">
              {dropIndex === index && <DropMarker />}
              <span
                draggable
                tabIndex={isText ? -1 : 0}
                aria-label={isText ? undefined : `Campo ${name}`}
                onDragStart={(event) => onDragStartPiece(index, event)}
                onDragEnd={onDragEnd}
                onDragOver={overPiece(index)}
                onDrop={dropOnPiece}
                onKeyDown={isText ? undefined : keyDown(index, false)}
                className={cn(
                  'group inline-flex h-7 cursor-grab items-center gap-0.5 rounded-md border pl-0.5 pr-1 text-xs outline-none active:cursor-grabbing',
                  'focus-visible:ring-2 focus-visible:ring-wa-primary/60',
                  isText
                    ? 'border-wa-border bg-white text-wa-text dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark'
                    : isCustom
                      ? 'border-amber-300 bg-amber-50 font-medium text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                      : 'border-wa-primary/40 bg-wa-primary/10 font-medium text-wa-primary-deep dark:text-wa-primary',
                )}
              >
                <GripVertical className="h-3 w-3 shrink-0 opacity-50" aria-hidden="true" />
                {isText ? (
                  <input
                    value={piece.text}
                    autoFocus={piece.id === focusId}
                    draggable={false}
                    onChange={(event) => onTextChange(index, event.target.value)}
                    onKeyDown={keyDown(index, true)}
                    size={Math.max(piece.text.length, 3)}
                    aria-label="Texto libre"
                    placeholder="texto"
                    className="min-w-0 bg-transparent px-0.5 outline-none placeholder:text-wa-muted"
                  />
                ) : (
                  <span className="px-0.5">{name}</span>
                )}
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={(event) => {
                    event.stopPropagation()
                    onRemove(index)
                  }}
                  aria-label={`Quitar ${name}`}
                  className="rounded p-0.5 opacity-60 hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                >
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              </span>
            </span>
          )
        })}
        {dropIndex === pieces.length && <DropMarker />}
      </div>
      {actions}
    </div>
  )
}
