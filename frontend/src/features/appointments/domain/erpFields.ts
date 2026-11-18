/**
 * Lo que el formulario de cita pide de más cuando las citas se envían al ERP
 * del negocio: el paquete del catálogo, el DNI y el método de pago. Las
 * mismas reglas las aplica el backend (appointments/domain/erp_push.py).
 */

import type { PaymentMethod } from '../types'

export interface CatalogPackage {
  id: number
  name: string
  sessions: number
  price?: string | number
  position?: number
  is_active?: boolean
  external_id?: string | null
}

export interface CatalogService {
  name: string
  packages?: CatalogPackage[]
}

export const PAYMENT_METHODS: { value: PaymentMethod; label: string }[] = [
  { value: 'yape', label: 'Yape' },
  { value: 'plin', label: 'Plin' },
  { value: 'transfer', label: 'Transferencia' },
  { value: 'cash', label: 'Efectivo' },
  { value: 'card', label: 'Tarjeta' },
]

/** Los paquetes del servicio que existen en el ERP, en el orden del catálogo. */
export function erpPackages(services: readonly CatalogService[], serviceName: string): CatalogPackage[] {
  const wanted = serviceName.trim().toLocaleLowerCase('es')
  if (!wanted) return []
  const service = services.find(item => item.name.trim().toLocaleLowerCase('es') === wanted)
  return (service?.packages ?? []).filter(item => item.external_id && item.is_active !== false)
}

/** El de menos sesiones: la cita del CRM es casi siempre una primera sesión. */
export function defaultPackage(packages: readonly CatalogPackage[]): CatalogPackage | null {
  if (packages.length === 0) return null
  return [...packages].sort((a, b) =>
    a.sessions - b.sessions || (a.position ?? 0) - (b.position ?? 0) || a.id - b.id)[0]
}

/** El paquete que va con la cita: el elegido si sigue siendo de ese servicio
 *  (un borrador viejo puede traer otro), si no el de menos sesiones. */
export function selectedPackage(packages: readonly CatalogPackage[], chosenId: string): CatalogPackage | null {
  return packages.find(item => String(item.id) === chosenId) ?? defaultPackage(packages)
}

export function packageLabel(item: CatalogPackage, currencySymbol: string): string {
  const sessions = item.sessions === 1 ? '1 sesión' : `${item.sessions} sesiones`
  const price = item.price === undefined || item.price === null ? '' : ` · ${currencySymbol}${Number(item.price).toFixed(2)}`
  return `${item.name} · ${sessions}${price}`
}

/** El ERP identifica al paciente por DNI y solo admite 8 dígitos. */
export function isValidDni(value: unknown): boolean {
  return /^\d{8}$/.test(String(value ?? '').replace(/[\s.-]/g, ''))
}
