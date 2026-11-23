const DAY = 24 * 60 * 60 * 1000

function startOfDay(moment: number): number {
  const date = new Date(moment)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

/**
 * Un momento dicho como lo diría una persona: «hoy a las 13:12», «mañana a
 * las 13:12», «el 25 de noviembre a las 13:12». Para avisar desde cuándo
 * Meta acepta otro cambio, donde una fecha completa cuesta más de leer.
 */
export function whenLabel(moment: number, now = Date.now()): string {
  const date = new Date(moment)
  const time = date.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false })
  const days = Math.round((startOfDay(moment) - startOfDay(now)) / DAY)
  if (days === 0) return `hoy a las ${time}`
  if (days === 1) return `mañana a las ${time}`
  if (days === -1) return `ayer a las ${time}`
  return `el ${date.toLocaleDateString('es-PE', { day: 'numeric', month: 'long' })} a las ${time}`
}
