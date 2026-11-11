import { useState } from 'react'
import type { DashboardFlowOrigins, DashboardFlowRow } from '../types'
import { formatNumber, formatShortDateTime } from './format'
import { StackedBarList, type StackSegment } from './primitives'
import { ReadingToggle } from './ReadingToggle'

type FlowReading = 'origin' | 'status'

// Los mismos dos colores que "Flujos por día": a mano y automáticos se
// reconocen de un panel al otro sin volver a leer la leyenda.
// Lo que inició otro flujo va en el mismo color, más claro y pegado a su
// origen: no es un tercer origen sino una parte de cada uno. Como categoría
// aparte obligaba a elegir entre perder quién lo empezó o dar dos cifras de
// "a mano" en la misma pestaña.
const ORIGIN_SEGMENTS: StackSegment[] = [
  { key: 'manual_direct', label: 'A mano', color: 'bg-[var(--viz-cat-1)]' },
  { key: 'manual_chained', label: 'A mano, por otro flujo', color: 'bg-[var(--viz-cat-1)]/45' },
  { key: 'automatic_direct', label: 'Automáticos', color: 'bg-[var(--viz-cat-2)]' },
  { key: 'automatic_chained', label: 'Automáticos, por otro flujo', color: 'bg-[var(--viz-cat-2)]/45' },
]
const CHAINED_KEYS = new Set(['manual_chained', 'automatic_chained'])

// El orden es el del ciclo de vida de un flujo, no el del tamaño: leerlo de
// izquierda a derecha cuenta qué pasó con los envíos.
const STATUS_SEGMENTS: StackSegment[] = [
  { key: 'completed', label: 'Completados', color: 'bg-viz-done dark:bg-viz-done-dark' },
  // Era "Activos", que en Automatizaciones significa "encendido": acá son los
  // que todavía esperan, corren o están en pausa.
  { key: 'active', label: 'Sin terminar', color: 'bg-viz-active dark:bg-viz-active-dark' },
  { key: 'skipped', label: 'Omitidos', color: 'bg-viz-idle dark:bg-viz-idle-dark' },
  { key: 'failed', label: 'Fallidos', color: 'bg-viz-failed dark:bg-viz-failed-dark' },
]

const READINGS: { key: FlowReading; label: string; hint: string; chainedHint?: string; segments: StackSegment[] }[] = [
  {
    key: 'origin',
    label: 'A mano o automáticos',
    hint: 'A mano: alguien lo inició desde un chat. Automáticos: se iniciaron solos, por su disparador.',
    chainedHint: 'Un flujo iniciado por otro flujo cuenta según cómo empezó el primero.',
    segments: ORIGIN_SEGMENTS,
  },
  {
    key: 'status',
    label: 'Cómo terminaron',
    hint: 'En qué quedó cada flujo iniciado en el período.',
    segments: STATUS_SEGMENTS,
  },
]

function share(part: number, total: number): string {
  return total ? `${Math.round((part / total) * 100)}%` : '0%'
}

interface Props {
  flows: DashboardFlowRow[]
  /** Totales del período. No se suman las filas: la lista trae solo los flujos
   *  más usados y el resumen quedaría corto. Sin esto no hay reparto que
   *  mostrar: lo propio de alguien es todo a mano. */
  totals: DashboardFlowOrigins | null
  onSelect: () => void
}

/**
 * Cada flujo con dos lecturas sobre las mismas filas: cómo se inició y cómo
 * terminó. Se alterna en vez de apilar las dos barras por fila: seis colores
 * juntos no se leen, y el orden de los flujos no cambia al pasar de una a otra.
 */
export function FlowsByFlowPanel({ flows, totals, onSelect }: Props) {
  const [readingKey, setReadingKey] = useState<FlowReading>('origin')
  // Una respuesta guardada de la versión anterior no trae el reparto por fila.
  const canSplit = totals !== null && flows.every(flow => flow.manual != null && flow.automatic != null)
  const reading = canSplit ? READINGS.find(item => item.key === readingKey) ?? READINGS[0] : READINGS[1]
  const total = totals ? totals.manual + totals.automatic : 0
  const chained = totals ? totals.manual_chained + totals.automatic_chained : 0
  // Sin flujos encadenados en el período, la leyenda no nombra algo que no se ve.
  const segments = reading.key === 'origin' && chained === 0
    ? reading.segments.filter(segment => !CHAINED_KEYS.has(segment.key))
    : reading.segments

  return (
    <div>
      {canSplit && flows.length > 0 && (
        <>
          <ReadingToggle label="Qué mostrar de cada flujo" options={READINGS} value={reading.key} onChange={setReadingKey} />
          <p className="mb-3 text-[11px] text-wa-muted dark:text-wa-muted-dark">{reading.hint}{chained > 0 && reading.chainedHint ? ` ${reading.chainedHint}` : ''}</p>
          {reading.key === 'origin' && totals && total > 0 && (
            <p className="mb-4 text-xs text-gray-600 dark:text-gray-300">
              De {formatNumber(total)} {total === 1 ? 'flujo iniciado' : 'flujos iniciados'},{' '}
              <strong className="font-semibold text-wa-text dark:text-wa-text-dark">{formatNumber(totals.manual)} a mano</strong> ({share(totals.manual, total)}) y{' '}
              <strong className="font-semibold text-wa-text dark:text-wa-text-dark">{formatNumber(totals.automatic)} {totals.automatic === 1 ? 'automático' : 'automáticos'}</strong> ({share(totals.automatic, total)}).
              {chained > 0 && (
                <>
                  {' '}De ese total, {formatNumber(chained)} {chained === 1 ? 'lo inició otro flujo' : 'los inició otro flujo'}:{' '}
                  {formatNumber(totals.manual_chained)} a partir de uno a mano y {formatNumber(totals.automatic_chained)} de uno automático.
                </>
              )}
            </p>
          )}
        </>
      )}
      <StackedBarList
        segments={segments}
        rows={flows.map(flow => ({
          key: String(flow.rule_id),
          label: flow.name,
          sublabel: flow.last_at ? `Último: ${formatShortDateTime(flow.last_at)}` : undefined,
          total: flow.value,
          // Van todas las partes: los segmentos de la lectura eligen cuáles se dibujan.
          parts: {
            manual_direct: (flow.manual ?? 0) - (flow.manual_chained ?? 0),
            manual_chained: flow.manual_chained ?? 0,
            automatic_direct: (flow.automatic ?? 0) - (flow.automatic_chained ?? 0),
            automatic_chained: flow.automatic_chained ?? 0,
            completed: flow.completed, active: flow.active, skipped: flow.skipped, failed: flow.failed,
          },
        }))}
        onSelect={onSelect}
      />
    </div>
  )
}
