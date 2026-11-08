import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'

/** Servicio que se llegó a cambiar desde Catálogos (al intentar eliminarlo). */
export interface ServiceHighlight {
  service: string
  reason: string | null
}

/** Mismo realce ámbar que el servicio de interés del lead (LeadFormDialog). */
export const HIGHLIGHT_RING = 'rounded-lg bg-amber-50 p-1.5 ring-2 ring-amber-400 ring-offset-2 ring-offset-white dark:bg-amber-950/30 dark:ring-offset-wa-panel-dark'

/**
 * Aviso arriba del formulario: qué cambiar, dónde está (marcado en ámbar) y,
 * cuando ya no lo usa, qué falta para soltarlo. Al aparecer lleva el foco al
 * primer campo marcado: con una regla de varias acciones, el campo quedaba
 * fuera de la vista y el usuario no sabía qué tocar.
 */
export function ServiceHighlightNotice({ highlight, where, doneHint }: { highlight: ServiceHighlight; where: string; doneHint: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Un cuadro (form o constructor) se monta con su contenido de una vez; el
    // siguiente cuadro de animación ya tiene el campo marcado en el DOM.
    const frame = requestAnimationFrame(() => {
      const root = ref.current?.closest('form, [data-flow-builder]')
      const field = root?.querySelector<HTMLElement>('[data-highlighted="true"] :is(input, button, select)')
      field?.scrollIntoView?.({ block: 'center' })
      field?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [])

  const done = where === ''
  return (
    <div ref={ref} role="status" className={`flex items-start gap-2 rounded-xl px-3 py-2.5 text-xs ${done ? 'bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200' : 'bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-200'}`}>
      {done ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
      <p className="min-w-0 flex-1 leading-5">
        {done
          ? <>Ya no usa <strong>«{highlight.service}»</strong>. {doneHint} y vuelve a <Link to="/catalogs" className="font-semibold underline">Catálogos</Link> para eliminarlo.</>
          : <>{highlight.reason ?? `Esta automatización usa «${highlight.service}».`} Está en {where}, marcado en amarillo.</>}
      </p>
    </div>
  )
}
