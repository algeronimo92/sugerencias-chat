import { useEffect, useEffectEvent, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { readEditField, withoutEditField } from '../../../shared/navigation/editFieldLink'
import type { ServiceHighlight } from '../components/ServiceHighlightNotice'
import type { AutomationRule } from '../types'

/** Campo que Catálogos pide cambiar al no poder eliminar un servicio. */
export const SERVICE_FIELD = 'servicio'

/**
 * Catálogos llega con `?editar=servicio&registro=<regla>&valor=<servicio>`:
 * se abre esa regla con lo que nombra al servicio resaltado. Antes el enlace
 * llevaba a la lista y el usuario tenía que adivinar qué regla y qué parte.
 *
 * Se consume una vez: los parámetros se quitan al abrir, así cerrar el
 * formulario o recargar no lo vuelve a abrir.
 */
export function useServiceEditLink(
  rules: AutomationRule[],
  isLoading: boolean,
  open: (rule: AutomationRule, highlight: ServiceHighlight) => void,
) {
  const [params, setParams] = useSearchParams()
  const request = readEditField(params)
  const target = request?.field === SERVICE_FIELD && request.record && request.value ? request : null
  const key = target ? `${target.record}:${target.value}` : null
  const handled = useRef<string | null>(null)
  const openRule = useEffectEvent(open)

  useEffect(() => {
    if (!target || !key || isLoading || handled.current === key) return
    handled.current = key
    setParams(current => withoutEditField(current), { replace: true })
    const rule = rules.find(item => String(item.id) === target.record)
    if (!rule) {
      toast.error('Esa automatización ya no existe. Vuelve a Catálogos para ver qué usa el servicio ahora.')
      return
    }
    openRule(rule, { service: target.value ?? '', reason: target.reason })
  }, [key, target, isLoading, rules, setParams])
}
