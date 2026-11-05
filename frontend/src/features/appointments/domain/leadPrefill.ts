/**
 * Cita agendada desde la ficha del lead: qué se toma del lead para prellenar
 * el formulario y qué corrigió el vendedor que podría volver al lead.
 *
 * Los campos del negocio de la cita y los del lead son listas separadas; se
 * cruzan solo cuando comparten la clave (p. ej. `dni`), sin configuración.
 */

import type { CustomFieldDefinition } from '../../catalogs/types'

export interface LeadSnapshot {
  id: string
  name: string | null
  phone: string | null
  servicio_interes: string | null
  /** Nombre del vendedor asignado al lead. */
  vendedor: string | null
  customFields: Record<string, unknown>
}

export interface PrefillValues {
  nombreCompleto: string
  telefono: string
  servicio: string
  vendedor: string
}

export interface LeadPrefill {
  form: PrefillValues
  customFields: Record<string, unknown>
  /** Claves (de `form` o `custom:<clave>`) que vinieron del lead. */
  prefilled: Set<string>
}

export const customKey = (key: string) => `custom:${key}`

function filled(value: unknown): boolean {
  return value !== null && value !== undefined && value !== ''
}

/** El responsable por defecto: el vendedor del lead si sigue en el equipo; si
 *  no, quien agenda. Se compara por nombre porque la cita guarda el nombre. */
function defaultSeller(lead: LeadSnapshot, sellers: readonly { name: string }[], me: string | null): string {
  const names = new Set(sellers.map(seller => seller.name))
  if (lead.vendedor && names.has(lead.vendedor)) return lead.vendedor
  return me && names.has(me) ? me : ''
}

export function prefillFromLead(
  lead: LeadSnapshot,
  appointmentFields: readonly CustomFieldDefinition[],
  sellers: readonly { name: string }[],
  me: string | null,
): LeadPrefill {
  const form: PrefillValues = {
    nombreCompleto: lead.name?.trim() ?? '',
    telefono: lead.phone ?? '',
    servicio: lead.servicio_interes?.trim() ?? '',
    vendedor: defaultSeller(lead, sellers, me),
  }
  const prefilled = new Set<string>((Object.keys(form) as (keyof PrefillValues)[]).filter(key => form[key]))
  const customFields: Record<string, unknown> = {}
  for (const field of appointmentFields) {
    const value = lead.customFields[field.key]
    if (!filled(value)) continue
    customFields[field.key] = value
    prefilled.add(customKey(field.key))
  }
  return { form, customFields, prefilled }
}

export interface LeadCorrection {
  /** `nombre`, `servicio_interes` o `custom:<clave>`. */
  key: string
  label: string
  from: unknown
  to: unknown
}

/**
 * Lo que el vendedor cambió respecto del lead y se puede llevar al lead. Un
 * dato que el lead no tenía también cuenta: completarlo es una corrección. Un
 * valor vaciado no: vaciar en la cita no borra el dato del lead.
 */
export function leadCorrections(
  lead: LeadSnapshot,
  form: { nombreCompleto: string; servicio: string },
  customFields: Record<string, unknown>,
  leadFields: readonly CustomFieldDefinition[],
): LeadCorrection[] {
  const corrections: LeadCorrection[] = []
  const name = form.nombreCompleto.trim()
  if (name && name !== (lead.name ?? '').trim()) {
    corrections.push({ key: 'nombre', label: 'Nombre', from: lead.name, to: name })
  }
  const service = form.servicio.trim()
  if (service && service !== (lead.servicio_interes ?? '').trim()) {
    corrections.push({ key: 'servicio_interes', label: 'Servicio', from: lead.servicio_interes, to: service })
  }
  for (const field of leadFields) {
    if (!(field.key in customFields)) continue
    const value = customFields[field.key]
    if (!filled(value) || value === lead.customFields[field.key]) continue
    corrections.push({ key: customKey(field.key), label: field.label, from: lead.customFields[field.key], to: value })
  }
  return corrections
}

export interface LeadUpdatesInput {
  nombre?: string
  servicio_interes?: string
  custom_fields: Record<string, unknown>
}

/** Las correcciones elegidas, en la forma que espera la API; null si no se
 *  eligió ninguna. */
export function leadUpdatesFor(corrections: readonly LeadCorrection[], chosen: ReadonlySet<string>): LeadUpdatesInput | null {
  const picked = corrections.filter(correction => chosen.has(correction.key))
  if (picked.length === 0) return null
  const updates: LeadUpdatesInput = { custom_fields: {} }
  for (const correction of picked) {
    if (correction.key === 'nombre') updates.nombre = String(correction.to)
    else if (correction.key === 'servicio_interes') updates.servicio_interes = String(correction.to)
    else updates.custom_fields[correction.key.slice('custom:'.length)] = correction.to
  }
  return updates
}
