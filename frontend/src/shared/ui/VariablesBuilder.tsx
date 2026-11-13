import { Plus, Type } from 'lucide-react'
import { useRef, useState, type DragEvent } from 'react'
import {
  fieldPiece,
  insertPiece,
  movePiece,
  removePiece,
  textPiece,
  updatePiece,
  type Piece,
  type PieceDraft,
  type PiecePosition,
} from '../pieces'
import { cn } from '../utils/cn'
import { PieceLine, type MoveDirection } from './PieceLine'

const paletteClass = 'inline-flex h-7 cursor-grab items-center gap-1 rounded-full border border-wa-border bg-white px-2.5 text-xs text-wa-text outline-none transition-colors hover:border-wa-primary/50 hover:bg-wa-hover focus-visible:ring-2 focus-visible:ring-wa-primary/60 active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-50 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark dark:hover:bg-wa-hover-dark'

export interface VariableFieldGroup {
  id: string
  label: string
  fields: Array<{ key: string; label: string }>
}

interface Props {
  groups: VariableFieldGroup[]
  /** Cómo se nombra cada campo dentro de una variable. */
  labels: Map<string, string>
  /** Nombre de cada variable de la plantilla (`1`, `2`… o con nombre). */
  variables: string[]
  /** Una línea de piezas por variable; `title` no se usa. */
  draft: PieceDraft
  /** Cómo sale cada variable, ya resuelta (con datos reales o de ejemplo). */
  rendered: string[]
  renderedLabel: string
  disabled?: boolean
  onChange: (draft: PieceDraft) => void
}

interface DragSource {
  piece: Piece
  from?: PiecePosition
}

/** Arma el contenido de cada variable de una plantilla oficial: a la
 *  izquierda los datos disponibles agrupados, a la derecha una fila por
 *  variable donde se arrastran (o se tocan para sumarlos a la fila marcada)
 *  y se mezclan con texto libre. Cada fila muestra cómo sale. */
export function VariablesBuilder({ groups, labels, variables, draft, rendered, renderedLabel, disabled = false, onChange }: Props) {
  const [activeZone, setActiveZone] = useState(0)
  const [dropAt, setDropAt] = useState<PiecePosition | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const dragging = useRef<DragSource | null>(null)

  const zoneLength = (zone: number) => (draft.lines[zone] ?? []).length

  const addToActive = (piece: Piece) => {
    if (disabled || draft.lines.length === 0) return
    const zone = Math.min(activeZone, draft.lines.length - 1)
    if (piece.kind === 'text') setFocusId(piece.id)
    onChange(insertPiece(draft, piece, { zone, index: zoneLength(zone) }))
  }

  const startDrag = (source: DragSource) => (event: DragEvent) => {
    dragging.current = source
    event.dataTransfer.effectAllowed = source.from ? 'move' : 'copy'
    // Firefox no arranca el arrastre sin datos.
    event.dataTransfer.setData('text/plain', source.piece.kind === 'field' ? source.piece.key : source.piece.text)
  }

  const endDrag = () => {
    dragging.current = null
    setDropAt(null)
  }

  const dropInto = (zone: number) => (index: number) => {
    const source = dragging.current
    endDrag()
    if (!source || disabled) return
    setActiveZone(zone)
    onChange(source.from ? movePiece(draft, source.from, { zone, index }) : insertPiece(draft, source.piece, { zone, index }))
  }

  const overZone = (zone: number) => (index: number) => {
    if (!dragging.current) return
    if (dropAt?.zone !== zone || dropAt.index !== index) setDropAt({ zone, index })
  }

  const moveWithKeys = (zone: number) => (index: number, direction: MoveDirection) => {
    if (direction === 'left' || direction === 'right') {
      const target = direction === 'left' ? index - 1 : index + 2
      if (target < 0 || target > zoneLength(zone)) return
      onChange(movePiece(draft, { zone, index }, { zone, index: target }))
      return
    }
    const targetZone = direction === 'up' ? zone - 1 : zone + 1
    if (targetZone < 0 || targetZone >= draft.lines.length) return
    setActiveZone(targetZone)
    onChange(movePiece(draft, { zone, index }, { zone: targetZone, index: zoneLength(targetZone) }))
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
      <aside className="space-y-3 rounded-lg border border-wa-border bg-wa-field/40 p-3 dark:border-wa-border-dark dark:bg-wa-field-dark/40">
        <p className="text-xs font-semibold text-wa-text dark:text-wa-text-dark">Datos disponibles</p>
        <button
          type="button"
          draggable
          disabled={disabled}
          onDragStart={event => startDrag({ piece: textPiece('texto') })(event)}
          onDragEnd={endDrag}
          onClick={() => addToActive(textPiece())}
          className={paletteClass}
        >
          <Type className="h-3 w-3 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
          Texto libre
        </button>
        {groups.filter(group => group.fields.length > 0).map(group => (
          <div key={group.id} className="space-y-1.5">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">{group.label}</p>
            <div className="flex flex-wrap gap-1">
              {group.fields.map(field => (
                <button
                  key={field.key}
                  type="button"
                  draggable
                  disabled={disabled}
                  onDragStart={event => startDrag({ piece: fieldPiece(field.key) })(event)}
                  onDragEnd={endDrag}
                  onClick={() => addToActive(fieldPiece(field.key))}
                  className={paletteClass}
                >
                  <Plus className="h-3 w-3 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
                  {field.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </aside>

      <ol className="space-y-2">
        {draft.lines.map((pieces, zone) => {
          const name = `{{${variables[zone] ?? zone + 1}}}`
          const active = activeZone === zone
          return (
            <li
              key={zone}
              className={cn(
                'rounded-lg border p-2.5 transition-colors',
                active ? 'border-wa-primary/50 bg-wa-primary/5' : 'border-wa-border dark:border-wa-border-dark',
              )}
            >
              <span className="mb-1.5 inline-block rounded-md bg-wa-field px-1.5 py-0.5 font-mono text-xs font-semibold text-wa-text dark:bg-wa-field-dark dark:text-wa-text-dark">{name}</span>
              <PieceLine
                pieces={pieces}
                fieldLabels={labels}
                focusId={focusId}
                active={active}
                dropIndex={dropAt?.zone === zone ? dropAt.index : null}
                label={`Variable ${name}`}
                placeholder="Arrastra un dato aquí"
                onActivate={() => setActiveZone(zone)}
                onDragStartPiece={(index, event) => startDrag({ piece: pieces[index], from: { zone, index } })(event)}
                onDragOverIndex={overZone(zone)}
                onDrop={dropInto(zone)}
                onDragEnd={endDrag}
                onRemove={index => onChange(removePiece(draft, { zone, index }))}
                onTextChange={(index, text) => onChange(updatePiece(draft, { zone, index }, text))}
                onMove={moveWithKeys(zone)}
              />
              <p className="mt-1.5 text-[11px] text-wa-muted dark:text-wa-muted-dark">
                {renderedLabel}:{' '}
                <span className={rendered[zone] ? 'font-medium text-wa-text dark:text-wa-text-dark' : 'italic'}>
                  {rendered[zone] || 'falta armarla'}
                </span>
              </p>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
