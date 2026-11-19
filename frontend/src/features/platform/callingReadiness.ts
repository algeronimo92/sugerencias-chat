import type { AppUser, CallingReadiness } from './types'

/**
 * Textos y reglas de la sección Llamadas de Integraciones, fuera del
 * componente para probarlos solos (docs/analisis/17-plan-llamadas-whatsapp.md,
 * fase 1). El vocabulario evita los nombres de Meta: "coexistencia", "Cloud
 * API" o "WABA" no le dicen nada a quien administra la clínica.
 */

/** El límite de mensajería como lo diría una persona: `TIER_2K` → "2000".
 *  `null` si el nivel no dice un número. */
export function messagingLimitLabel(tier: string | null | undefined): string | null {
  if (!tier) return null
  if (tier === 'TIER_UNLIMITED') return 'sin límite'
  const match = /^TIER_(\d+)(K|M)?$/.exec(tier)
  if (!match) return null
  const multiplier = match[2] === 'M' ? 1_000_000 : match[2] === 'K' ? 1_000 : 1
  // Sin separador de miles: el de es-PE (coma) se lee como decimal en otros
  // países y el número es corto.
  return String(Number(match[1]) * multiplier)
}

/** Quién puede recibir el permiso: el analista solo ve el dashboard, y una
 *  cuenta desactivada no entra al CRM. Una invitación pendiente sí: el admin
 *  puede dejarla lista antes de que la persona cree su contraseña. */
export function canReceiveCallsPermission(user: AppUser): boolean {
  return user.role !== 'analista' && (user.is_active || user.invitation_pending)
}

export type ReadinessTone = 'ok' | 'action' | 'unknown'

export interface ReadinessCopy {
  tone: ReadinessTone
  title: string
  body: string
}

export function readinessCopy(readiness: CallingReadiness): ReadinessCopy {
  switch (readiness.state) {
    case 'requires_migration':
      return {
        tone: 'action',
        title: 'Para atender llamadas desde el CRM hay que mudar el número',
        body: 'Tu número también se usa en la app de WhatsApp Business. Meta solo permite atender llamadas desde el CRM en números que funcionan únicamente aquí.',
      }
    case 'limit_too_low':
      return {
        tone: 'action',
        title: 'Tu cuenta todavía no cumple el límite de mensajes que pide Meta',
        body: `Meta exige poder escribir a 2000 personas por día para activar llamadas${limitSuffix(readiness)}. Se sube verificando el negocio en Meta Business.`,
      }
    case 'unverified':
      return {
        tone: 'unknown',
        title: 'Meta no informó si el número cumple los requisitos',
        body: 'Vuelve a consultar en unos minutos. Si sigue igual, revisa el número en WhatsApp Manager.',
      }
    case 'ready':
      return {
        tone: 'ok',
        title: 'El número cumple los requisitos de Meta para llamadas',
        body: 'Elige quiénes atienden y actívalas abajo, con su horario.',
      }
    default:
      return {
        tone: 'unknown',
        title: 'WhatsApp no está conectado',
        body: 'Conecta el número para saber si puede atender llamadas.',
      }
  }
}

function limitSuffix(readiness: CallingReadiness): string {
  const label = messagingLimitLabel(readiness.messaging_limit)
  return label ? ` (hoy: ${label})` : ''
}

/** Lo que cambia al mudar el número. Va antes de cualquier paso porque no
 *  se puede deshacer. */
export const MIGRATION_CHANGES = [
  'Dejas de usar la app de WhatsApp Business en ese número: ahí se pierden los grupos, los estados, las listas de difusión y las etiquetas.',
  'Las llamadas se atienden solo desde el CRM, por las personas que elijas abajo. Con el CRM cerrado no suena como un teléfono: llega una notificación.',
  'Los chats y el historial del CRM no cambian.',
] as const

export const WEEK_DAYS = [
  ['MONDAY', 'Lun'], ['TUESDAY', 'Mar'], ['WEDNESDAY', 'Mié'], ['THURSDAY', 'Jue'],
  ['FRIDAY', 'Vie'], ['SATURDAY', 'Sáb'], ['SUNDAY', 'Dom'],
] as const
export type WeekDay = typeof WEEK_DAYS[number][0]

export interface HoursForm {
  days: WeekDay[]
  /** "HH:MM", como lo da un campo de hora. */
  open: string
  close: string
}

export const DEFAULT_HOURS: HoursForm = { days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'], open: '09:00', close: '19:00' }

/** El formulario maneja un solo tramo para los días elegidos: es lo que usa
 *  una clínica. Si en Meta hay algo más fino, se muestra su primer tramo. */
export function hoursFormFrom(slots: { day: string; open: string; close: string }[]): HoursForm {
  if (slots.length === 0) return DEFAULT_HOURS
  const [first] = slots
  const colon = (value: string) => `${value.slice(0, 2)}:${value.slice(2, 4)}`
  return {
    days: WEEK_DAYS.map(([day]) => day).filter(day => slots.some(slot => slot.day === day)),
    open: colon(first.open),
    close: colon(first.close),
  }
}

export function hoursSlots(form: HoursForm): { day: WeekDay; open: string; close: string }[] {
  return form.days.map(day => ({ day, open: form.open.replace(':', ''), close: form.close.replace(':', '') }))
}

export function hoursError(form: HoursForm): string | null {
  if (form.days.length === 0) return 'Elige al menos un día'
  if (!form.open || !form.close || form.open >= form.close) return 'La hora de cierre tiene que ser posterior a la de apertura'
  return null
}
