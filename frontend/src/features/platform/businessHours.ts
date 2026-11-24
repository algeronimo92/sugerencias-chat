import type { BusinessDayHours } from './types'

const DAY_NAMES = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo']
const SHORT_NAMES = ['lun', 'mar', 'mié', 'jue', 'vie', 'sáb', 'dom']

/** «lun a vie 08:00–18:00; sáb 09:00–13:00». Mismo agrupado que el motivo
 *  que el motor deja en el historial (`BusinessHours.describe` del backend),
 *  con los días abreviados para que entre en el panel del editor. */
export function describeBusinessHours(days: readonly BusinessDayHours[], { short = true } = {}): string {
  const names = short ? SHORT_NAMES : DAY_NAMES
  const open = days.filter(day => day.open).sort((a, b) => a.weekday - b.weekday)
  if (open.length === 0) return 'sin días de atención'
  const groups: { first: number; last: number; start: string; end: string }[] = []
  for (const day of open) {
    const previous = groups.at(-1)
    if (previous && previous.last === day.weekday - 1 && previous.start === day.start && previous.end === day.end) previous.last = day.weekday
    else groups.push({ first: day.weekday, last: day.weekday, start: day.start, end: day.end })
  }
  return groups
    .map(group => `${group.first === group.last ? names[group.first] : `${names[group.first]} a ${names[group.last]}`} ${group.start}–${group.end}`)
    .join('; ')
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }

/** ¿El negocio está atendiendo en ese instante, en su zona horaria? El cierre
 *  es exclusivo, igual que en el backend: a las 18:00 en punto ya cerró.
 *  `null` si el navegador no conoce la zona. */
export function isOpenAt(days: readonly BusinessDayHours[], timezone: string, moment: Date): boolean | null {
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(moment)
  } catch {
    return null
  }
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? ''
  const weekday = WEEKDAY_INDEX[part('weekday')]
  const time = `${part('hour')}:${part('minute')}`
  const day = days.find(item => item.weekday === weekday)
  return !!day && day.open && day.start <= time && time < day.end
}
