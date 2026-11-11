import type { Organization } from '../../types'

export type TonoEstado = 'ok' | 'aviso' | 'error' | 'neutro'

const ESTADOS: Record<string, { label: string; tono: TonoEstado }> = {
  active: { label: 'Activo', tono: 'ok' },
  suspended: { label: 'Suspendido', tono: 'aviso' },
  provisioning: { label: 'Preparando', tono: 'neutro' },
  failed: { label: 'Alta fallida', tono: 'error' },
  deleting: { label: 'Eliminando', tono: 'neutro' },
}

export function estadoDeNegocio(status: string): { label: string; tono: TonoEstado } {
  return ESTADOS[status] ?? { label: status, tono: 'neutro' }
}

export function dominioPrincipal(organizacion: Organization): string | null {
  return (organizacion.domains.find((dominio) => dominio.is_primary) ?? organizacion.domains[0])?.hostname ?? null
}

/** Enlace al CRM del negocio. Hereda protocolo y puerto del panel: en
 *  producción ambos van por https sin puerto y en desarrollo los dos por :5173. */
export function urlDelCrm(hostname: string): string {
  const { protocol, port } = window.location
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`
}

export function etiquetaIA(organizacion: Organization): string {
  if (!organizacion.ai_enabled) return 'IA deshabilitada'
  return organizacion.ai_monthly_quota === null ? 'IA sin límite' : `IA · ${organizacion.ai_monthly_quota} al mes`
}
