/** Vocabulario de los filtros de "Flujos enviados", compartido entre la
 *  página (que arma la consulta) y el componente que los dibuja. */

export type PeriodKey = 'today' | 'week' | 'month' | 'custom'

/** A quién pertenecen los envíos listados: 'me', 'team' o el id de una persona. */
export type SenderKey = 'me' | 'team' | number

export const PERIODS: readonly { key: PeriodKey; label: string; offset: number | null }[] = [
  { key: 'today', label: 'Hoy', offset: 0 },
  { key: 'week', label: '7 días', offset: -6 },
  { key: 'month', label: '30 días', offset: -29 },
  { key: 'custom', label: 'Otro', offset: null },
]
