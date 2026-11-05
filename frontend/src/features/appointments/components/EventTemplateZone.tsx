import { GripVertical, X } from 'lucide-react'
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import { cn } from '../../../shared/utils/cn'
import type { Piece } from '../domain/eventTemplate'

export type MoveDirection = 'left' | 'right' | 'up' | 'down'

interface Props {
  label: string
  pieces: Piece[]
  fieldLabels: Map<string, string>
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
  label, pieces, fieldLabels, dropIndex, active, focusId, placeholder, actions,
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
          'flex min-h-9 flex-1 flex-wrap items-center gap-1 rounded-lg border px-1.5 py-1 transition-colors',
          dropIndex !== null
            ? 'border-wa-primary/60'
            : active
              ? 'border-wa-muted/50 dark:border-wa-muted-dark/50'
              : 'border-wa-border dark:border-wa-border-dark',
        )}
      >
        {pieces.length === 0 && dropIndex === null && (
          <span className="pointer-events-none px-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">{placeholder}</span>
        )}
        {pieces.map((piece, index) => {
          const isText = piece.kind === 'text'
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
                  'group inline-flex h-7 cursor-grab items-center gap-0.5 rounded-md pl-0.5 pr-1 text-xs outline-none active:cursor-grabbing',
                  'focus-visible:ring-2 focus-visible:ring-wa-primary/60',
                  // El campo es un bloque; el texto libre se lee como lo que
                  // es: texto escrito entre bloques.
                  isText
                    ? 'text-wa-muted dark:text-wa-muted-dark'
                    : 'bg-wa-field font-medium text-wa-text dark:bg-wa-field-dark dark:text-wa-text-dark',
                )}
              >
                <GripVertical className="h-3 w-3 shrink-0 opacity-40" aria-hidden="true" />
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
                    className="min-w-0 border-b border-dashed border-wa-border bg-transparent px-0.5 text-wa-text outline-none placeholder:text-wa-muted focus:border-wa-muted dark:border-wa-border-dark dark:text-wa-text-dark"
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
                  className="rounded p-0.5 text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark"
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
