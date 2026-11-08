import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { readEditField, withoutEditField } from '../../../shared/navigation/editFieldLink'
import type { ServiceHighlight } from '../components/ServiceHighlightNotice'
import type { AutomationRule } from '../types'

/** Campo que Catálogos pide cambiar al no poder eliminar un servicio. */
export const SERVICE_FIELD = 'servicio'

export interface ServiceEditLink {
  /** Distingue un enlace de otro: la pantalla abre cada uno una sola vez. */
  key: string
  rule: AutomationRule
  highlight: ServiceHighlight
}

/**
 * Catálogos llega con `?editar=servicio&registro=<regla>&valor=<servicio>`:
 * la pantalla abre esa regla con lo que nombra al servicio resaltado. Antes el
 * enlace llevaba a la lista y el usuario tenía que adivinar qué regla y qué parte.
 *
 * Devuelve qué abrir (la pantalla lo abre al renderizar, sin un render de más)
 * y, ya cargadas las reglas, quita los parámetros: cerrar el formulario o
 * recargar no lo vuelve a abrir.
 */
export function useServiceEditLink(rules: AutomationRule[], isLoading: boolean): ServiceEditLink | null {
  const [params, setParams] = useSearchParams()
  const request = readEditField(params)
  const record = request?.field === SERVICE_FIELD ? request.record : null
  const service = request?.field === SERVICE_FIELD ? request.value : null
  const pending = record !== null && service !== null && !isLoading
  const rule = pending ? rules.find(item => String(item.id) === record) ?? null : null

  useEffect(() => {
    if (!pending) return
    setParams(current => withoutEditField(current), { replace: true })
    if (!rule) toast.error('Esa automatización ya no existe. Vuelve a Catálogos para ver qué usa el servicio ahora.')
  }, [pending, rule, setParams])

  return rule && service !== null
    ? { key: `${record}:${service}`, rule, highlight: { service, reason: request?.reason ?? null } }
    : null
}
