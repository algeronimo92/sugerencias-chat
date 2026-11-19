import { CircleHelp } from 'lucide-react'
import { Tooltip } from '../../../../shared/ui/Tooltip'
import { FLOW_TONES, flowTone } from '../../domain/flowTones'
import type { FlowPaletteItem } from './flowPalette'

/**
 * Un bloque de la paleta «Agregar bloque»: solo el nombre (2026-11-18).
 *
 * Antes cada uno mostraba debajo su descripción en dos líneas, y la paleta
 * era una columna de 7 párrafos que había que recorrer para encontrar un
 * nombre. La descripción sigue a mano: al pasar el mouse o llegar con el
 * teclado aparece en el tooltip, y el lector de pantalla la lee con el botón.
 */
export function FlowPaletteButton({ item, onAdd }: { item: FlowPaletteItem; onAdd: (type: FlowPaletteItem['type']) => void }) {
  const { type, label, icon: Icon, description } = item
  return (
    <Tooltip
      side="right"
      content={<><span className="block">{description}</span><span className="mt-1 block text-[11px] font-normal opacity-75">Clic para agregarlo o arrástralo al lienzo.</span></>}
    >
      <button
        type="button"
        draggable
        onDragStart={event => event.dataTransfer.setData('application/x-flow-palette', type)}
        onClick={() => onAdd(type)}
        className="group mb-2 flex min-h-12 w-full cursor-grab items-center gap-3 rounded-xl border border-wa-border bg-wa-hover px-3 py-3 text-left text-sm font-semibold text-gray-800 hover:border-wa-primary/40 focus-visible:outline-2 focus-visible:outline-wa-primary active:cursor-grabbing dark:border-wa-border-dark dark:bg-white/[0.03] dark:text-wa-text-dark dark:transition-colors dark:hover:bg-white/5"
      >
        <Icon className={`h-5 w-5 shrink-0 ${FLOW_TONES[flowTone(type)].icon}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-snug">{label}</span>
        <span className="sr-only">: {description}</span>
        <CircleHelp className="h-4 w-4 shrink-0 text-wa-muted opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden="true" />
      </button>
    </Tooltip>
  )
}
