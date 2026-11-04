/**
 * Seguimientos de un click desde el chat. Crear una tarea pedía abrir un
 * formulario de cinco campos para lo que casi siempre es lo mismo: "volver a
 * escribirle a este lead más tarde". Estas opciones cubren esos casos; el
 * formulario completo sigue disponible para lo demás.
 */

export interface QuickFollowUp {
  id: 'in-2h' | 'tomorrow' | 'in-3-days' | 'next-week'
  label: string
}

export const QUICK_FOLLOW_UPS: readonly QuickFollowUp[] = [
  { id: 'in-2h', label: 'En 2 h' },
  { id: 'tomorrow', label: 'Mañana' },
  { id: 'in-3-days', label: 'En 3 días' },
  { id: 'next-week', label: 'En 1 semana' },
]

/** Hora del día a la que caen los seguimientos por días: apertura de la clínica,
 *  no la misma hora en que el vendedor pulsó el botón (que puede ser de noche). */
const MORNING_HOUR = 9

function atMorning(base: Date, days: number): Date {
  const date = new Date(base)
  date.setDate(date.getDate() + days)
  date.setHours(MORNING_HOUR, 0, 0, 0)
  return date
}

export function quickFollowUpDue(id: QuickFollowUp['id'], now: Date = new Date()): Date {
  switch (id) {
    case 'in-2h': {
      const date = new Date(now.getTime() + 2 * 60 * 60 * 1000)
      // Redondeo a 5 minutos: un recordatorio a las 16:37:12 se ve como un error.
      date.setMinutes(Math.ceil(date.getMinutes() / 5) * 5, 0, 0)
      return date
    }
    case 'tomorrow': return atMorning(now, 1)
    case 'in-3-days': return atMorning(now, 3)
    case 'next-week': return atMorning(now, 7)
  }
}
