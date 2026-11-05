import { AlignLeft, Check, Loader2, Plus, RotateCcw, Trash2, Type } from 'lucide-react'
import { useMemo, useRef, useState, type DragEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { extractErrorMessage } from '../../../shared/utils/errors'
import {
  addLine,
  canDrop,
  fieldPiece,
  insertPiece,
  movePiece,
  parseTemplate,
  previewEvent,
  removeLine,
  removePiece,
  serializeDraft,
  textPiece,
  updatePiece,
  type Piece,
  type PiecePosition,
  type TemplateDraft,
  type ZoneId,
} from '../domain/eventTemplate'
import { useCalendarEventTemplate, useSaveCalendarEventTemplate } from '../queries'
import type { CalendarEventTemplate } from '../types'
import { EventTemplateZone, type MoveDirection } from './EventTemplateZone'

const sectionLabel = 'text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark'

/** Arma el título y la descripción del evento de Google Calendar con los
 *  campos de la cita, arrastrando piezas o tocándolas para sumarlas a la
 *  línea elegida. Vive en citas; la pestaña Calendario lo recibe desde app/. */
export function CalendarEventTemplateEditor() {
  const { data, isLoading, isError } = useCalendarEventTemplate()

  if (isLoading) {
    return <Loader2 className="mx-auto h-4 w-4 animate-spin text-wa-muted" aria-label="Cargando plantilla" />
  }
  if (isError || !data) {
    return <p className="text-xs text-red-500 dark:text-red-400">No se pudo cargar la plantilla del evento.</p>
  }
  // El borrador nace de la primera plantilla leída y sigue vivo al guardar:
  // la respuesta es la misma plantilla y "sin cambios" sale de comparar.
  return <TemplateEditor template={data} />
}

interface DragSource {
  piece: Piece
  from?: PiecePosition
}

function TemplateEditor({ template }: { template: CalendarEventTemplate }) {
  const save = useSaveCalendarEventTemplate()
  const knownKeys = useMemo(() => new Set(template.fields.map((field) => field.key)), [template.fields])
  const fieldLabels = useMemo(() => new Map(template.fields.map((field) => [field.key, field.label])), [template.fields])
  const customKeys = useMemo(
    () => new Set(template.fields.filter((field) => field.custom).map((field) => field.key)),
    [template.fields],
  )
  const [draft, setDraft] = useState<TemplateDraft>(
    () => parseTemplate(template.title_template, template.description_template, knownKeys),
  )
  const [activeZone, setActiveZone] = useState<ZoneId>('title')
  const [dropAt, setDropAt] = useState<PiecePosition | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const dragging = useRef<DragSource | null>(null)

  const serialized = serializeDraft(draft)
  const dirty = serialized.title !== template.title_template || serialized.description !== template.description_template
  const preview = previewEvent(draft, template.fields)
  const isDefault = serialized.title === template.default_title_template
    && serialized.description === template.default_description_template

  const change = (next: TemplateDraft) => {
    save.reset()
    setDraft(next)
  }

  const zoneLength = (zone: ZoneId) => (zone === 'title' ? draft.title : draft.lines[zone] ?? []).length

  const addToActive = (piece: Piece) => {
    const zone = canDrop(piece, activeZone) ? activeZone : draft.lines.length - 1
    if (piece.kind === 'text') setFocusId(piece.id)
    change(insertPiece(draft, piece, { zone, index: zoneLength(zone) }))
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

  const dropInto = (zone: ZoneId) => (index: number) => {
    const source = dragging.current
    endDrag()
    if (!source) return
    setActiveZone(zone)
    change(source.from
      ? movePiece(draft, source.from, { zone, index })
      : insertPiece(draft, source.piece, { zone, index }))
  }

  const overZone = (zone: ZoneId) => (index: number) => {
    const source = dragging.current
    if (!source || !canDrop(source.piece, zone)) return
    if (dropAt?.zone !== zone || dropAt.index !== index) setDropAt({ zone, index })
  }

  const moveWithKeys = (zone: ZoneId) => (index: number, direction: MoveDirection) => {
    const zones: ZoneId[] = ['title', ...draft.lines.map((_, line) => line)]
    const position = zones.indexOf(zone)
    if (direction === 'left' || direction === 'right') {
      const target = direction === 'left' ? index - 1 : index + 2
      if (target < 0 || target > zoneLength(zone)) return
      change(movePiece(draft, { zone, index }, { zone, index: target }))
      return
    }
    const targetZone = zones[direction === 'up' ? position - 1 : position + 1]
    if (targetZone === undefined) return
    setActiveZone(targetZone)
    change(movePiece(draft, { zone, index }, { zone: targetZone, index: zoneLength(targetZone) }))
  }

  const zoneProps = (zone: ZoneId, pieces: Piece[]) => ({
    pieces,
    fieldLabels,
    customKeys,
    focusId,
    active: activeZone === zone,
    dropIndex: dropAt?.zone === zone ? dropAt.index : null,
    onActivate: () => setActiveZone(zone),
    onDragStartPiece: (index: number, event: DragEvent) => startDrag({ piece: pieces[index], from: { zone, index } })(event),
    onDragOverIndex: overZone(zone),
    onDrop: dropInto(zone),
    onDragEnd: endDrag,
    onRemove: (index: number) => change(removePiece(draft, { zone, index })),
    onTextChange: (index: number, text: string) => change(updatePiece(draft, { zone, index }, text)),
    onMove: moveWithKeys(zone),
  })

  const resetToDefault = () => change(parseTemplate(
    template.default_title_template, template.default_description_template, knownKeys,
  ))

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <p className={sectionLabel}>Piezas</p>
        <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
          Arrastra un campo a una línea, o tócalo para sumarlo a la línea marcada. Las líneas cuyos campos quedan vacíos
          no aparecen en el evento.
        </p>
        <div className="flex flex-wrap gap-1">
          {template.fields.map((field) => (
            <button
              key={field.key}
              type="button"
              draggable
              onDragStart={(event) => startDrag({ piece: fieldPiece(field.key) })(event)}
              onDragEnd={endDrag}
              onClick={() => addToActive(fieldPiece(field.key))}
              className={
                field.custom
                  ? 'inline-flex h-7 cursor-grab items-center rounded-md border border-amber-300 bg-amber-50 px-2 text-xs font-medium text-amber-900 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                  : 'inline-flex h-7 cursor-grab items-center rounded-md border border-wa-primary/40 bg-wa-primary/10 px-2 text-xs font-medium text-wa-primary-deep hover:bg-wa-primary/20 dark:text-wa-primary'
              }
            >
              <Plus className="mr-0.5 h-3 w-3" aria-hidden="true" />
              {field.label}
            </button>
          ))}
          <button
            type="button"
            draggable
            onDragStart={(event) => startDrag({ piece: textPiece('texto') })(event)}
            onDragEnd={endDrag}
            onClick={() => addToActive(textPiece())}
            className="inline-flex h-7 cursor-grab items-center rounded-md border border-wa-border bg-white px-2 text-xs font-medium text-wa-text hover:bg-wa-hover dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
          >
            <Type className="mr-1 h-3 w-3" aria-hidden="true" />
            Texto libre
          </button>
        </div>
      </div>

      <div className="space-y-1.5">
        <p className={sectionLabel}>Título del evento</p>
        <EventTemplateZone {...zoneProps('title', draft.title)} label="Título del evento" placeholder="Vacío: se usa el servicio" />
      </div>

      <div className="space-y-1.5">
        <p className={sectionLabel}>Descripción</p>
        {draft.lines.map((pieces, line) => (
          <EventTemplateZone
            key={line}
            {...zoneProps(line, pieces)}
            label={`Línea ${line + 1} de la descripción`}
            placeholder="Línea en blanco (separador)"
            actions={(
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-7 shrink-0"
                onClick={() => change(removeLine(draft, line))}
                aria-label={`Quitar la línea ${line + 1}`}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
              </Button>
            )}
          />
        ))}
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setActiveZone(draft.lines.length)
            change(addLine(draft))
          }}
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Agregar línea
        </Button>
      </div>

      <div className="space-y-1.5">
        <p className={sectionLabel}>Así se verá (con una cita de ejemplo)</p>
        <div className="rounded-xl border border-wa-border bg-white p-3 dark:border-wa-border-dark dark:bg-wa-head-dark">
          <div className="flex items-start gap-2.5">
            <span className="mt-1 h-3 w-3 shrink-0 rounded-sm bg-sky-500" aria-hidden="true" />
            <div className="min-w-0">
              <p className="break-words text-sm font-medium text-wa-text dark:text-wa-text-dark">{preview.title}</p>
              <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">Miércoles, 21 de octubre · 10:00 – 11:00</p>
            </div>
          </div>
          {preview.description && (
            <div className="mt-2 flex items-start gap-2.5">
              <AlignLeft className="mt-0.5 h-3 w-3 shrink-0 text-wa-muted" aria-hidden="true" />
              <p className="whitespace-pre-line break-words text-xs text-wa-text dark:text-wa-text-dark">{preview.description}</p>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {save.isError && <p className="mr-auto text-xs text-red-500 dark:text-red-400">{extractErrorMessage(save.error)}</p>}
        {save.isSuccess && !dirty && (
          <p className="mr-auto flex items-center gap-1 text-xs text-wa-primary-strong dark:text-wa-primary">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Guardado: las citas nuevas usan este formato
          </p>
        )}
        <Button variant="ghost" size="sm" onClick={resetToDefault} disabled={isDefault || save.isPending}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Formato original
        </Button>
        <Button size="sm" onClick={() => save.mutate(serialized)} disabled={!dirty || save.isPending}>
          {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          Guardar formato
        </Button>
      </div>
    </div>
  )
}
