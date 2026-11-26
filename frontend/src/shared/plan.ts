import { useCallback } from 'react'

import { useMe } from './auth'
import type { AuthUser } from './types'

/**
 * Funciones que no vienen en todos los paquetes
 * (backend/app/modules/platform/plans.py). Igual que con los permisos, la app
 * esconde con esto y el backend igual lo exige en cada ruta.
 */
export const FEATURES = [
  'leads.auto_assign',
  'catalogs.custom_fields',
  'appointments.notice_sender',
  'dashboard.reports_export',
  'meta.conversions',
  'catalogs.erp_sync',
] as const

export type Feature = (typeof FEATURES)[number]

export const FEATURE_LABELS: Record<Feature, string> = {
  'leads.auto_assign': 'Reparto automático de leads',
  'catalogs.custom_fields': 'Campos propios en la ficha',
  'appointments.notice_sender': 'Número aparte para los avisos de cita',
  'dashboard.reports_export': 'Reportes en Excel',
  'meta.conversions': 'Eventos de conversión a Meta',
  'catalogs.erp_sync': 'Precios sincronizados con tu sistema',
}

/** El paquete más barato que trae cada función, para el aviso de "viene desde". */
export const FEATURE_MIN_PLAN: Record<Feature, string> = {
  'leads.auto_assign': 'Esencial',
  'catalogs.custom_fields': 'Esencial',
  'appointments.notice_sender': 'Esencial',
  'dashboard.reports_export': 'Esencial',
  'meta.conversions': 'Profesional',
  'catalogs.erp_sync': 'Profesional',
}

type Who = Pick<AuthUser, 'features'> | null | undefined

/**
 * Si el negocio de la sesión tiene la función. Una respuesta de /me sin
 * `features` (vieja, o un doble de test) se toma como "trae todo": el backend
 * igual bloquea, y así nunca se esconde algo por una sesión desactualizada.
 */
export function hasFeature(user: Who, feature: Feature): boolean {
  if (!user) return false
  if (user.features == null) return true
  return user.features.includes(feature)
}

/** `hasFeature` con la sesión: `const tiene = useFeature(); tiene('meta.conversions')`. */
export function useFeature(): (feature: Feature) => boolean {
  const { data: me } = useMe()
  return useCallback((feature: Feature) => hasFeature(me, feature), [me])
}

/** Texto para lo que el paquete no trae. */
export function featureUpsell(feature: Feature): string {
  return `${FEATURE_LABELS[feature]} viene desde el paquete ${FEATURE_MIN_PLAN[feature]}. Para cambiar de paquete, contacta al equipo de CliniVentas.`
}
