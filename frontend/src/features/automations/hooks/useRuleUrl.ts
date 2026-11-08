import { useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { EDIT_RECORD_PARAM, readEditField, withoutEditField } from '../../../shared/navigation/editFieldLink'
import type { ServiceHighlight } from '../components/ServiceHighlightNotice'
import type { AutomationRule } from '../types'

/** La automatización abierta: `/automations?automatizacion=<id>`. */
export const OPEN_RULE_PARAM = 'automatizacion'
/** El bloque al que abrir el flujo (`&bloque=<id>`), p. ej. desde el historial. */
export const OPEN_BLOCK_PARAM = 'bloque'

/** Lo que Catálogos pide revisar: la acción que asigna el servicio (impide
 *  eliminarlo) o la condición que filtra por su nombre (solo se avisa). */
const PARTS: Record<string, ServiceHighlight['part']> = { servicio: 'action', servicio_filtro: 'condition' }

export interface RuleUrl {
  /** La regla que la URL pide tener abierta (null si ninguna o aún cargan). */
  rule: AutomationRule | null
  highlight: ServiceHighlight | null
  /** Bloque al que abrir el flujo, si la URL lo pide. */
  block: string | null
  /** Cambia cuando la URL pide abrir otra cosa: la pantalla abre una vez por valor. */
  key: string | null
  open: (ruleId: number, block?: string) => void
  close: () => void
}

/**
 * La URL dice qué automatización está abierta. Antes el editor se abría sin
 * tocarla: recargar lo cerraba, no se podía pasar el enlace a otra persona y
 * no se veía qué flujo era (2026-11-08).
 *
 * Catálogos llega con `?editar=servicio|servicio_filtro&registro=<id>&valor=<servicio>`
 * para abrir la regla con lo que nombra al servicio resaltado; se normaliza a
 * `?automatizacion=<id>` conservando el realce, así recargar lo mantiene.
 */
export function useRuleUrl(rules: AutomationRule[], isLoading: boolean): RuleUrl {
  const [params, setParams] = useSearchParams()
  const request = readEditField(params)
  const part = request ? PARTS[request.field] : undefined
  const linked = part ? request?.record ?? null : null
  const ruleId = params.get(OPEN_RULE_PARAM) ?? linked
  const highlight = part && request?.value ? { service: request.value, reason: request.reason, part } : null
  const rule = ruleId !== null && !isLoading ? rules.find(item => String(item.id) === ruleId) ?? null : null
  const block = params.get(OPEN_BLOCK_PARAM)
  const missing = ruleId !== null && !isLoading && rule === null

  useEffect(() => {
    if (missing) {
      toast.error('Esa automatización ya no existe.')
      setParams(current => {
        const next = withoutEditField(current)
        next.delete(OPEN_RULE_PARAM)
        next.delete(OPEN_BLOCK_PARAM)
        return next
      }, { replace: true })
    } else if (rule && linked !== null) {
      setParams(current => {
        const next = new URLSearchParams(current)
        next.delete(EDIT_RECORD_PARAM)
        next.set(OPEN_RULE_PARAM, String(rule.id))
        return next
      }, { replace: true })
    }
  }, [missing, rule, linked, setParams])

  // `replace`: abrir o cerrar no agrega entradas al historial. Con "atrás"
  // cerrando el editor se perderían cambios sin guardar sin preguntar.
  const open = useCallback((id: number, blockId?: string) => setParams(current => {
    const next = withoutEditField(current)
    next.set(OPEN_RULE_PARAM, String(id))
    if (blockId) next.set(OPEN_BLOCK_PARAM, blockId)
    else next.delete(OPEN_BLOCK_PARAM)
    return next
  }, { replace: true }), [setParams])
  const close = useCallback(() => setParams(current => {
    const next = withoutEditField(current)
    next.delete(OPEN_RULE_PARAM)
    next.delete(OPEN_BLOCK_PARAM)
    return next
  }, { replace: true }), [setParams])

  return {
    rule,
    highlight,
    block,
    key: rule ? `${rule.id}:${highlight?.part ?? ''}:${highlight?.service ?? ''}:${block ?? ''}` : null,
    open,
    close,
  }
}
