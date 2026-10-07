/** Formato que espera un <input type="datetime-local">: hora local, sin zona.
 * El viaje de vuelta es `new Date(valor).toISOString()`, que reinterpreta esa
 * hora local en UTC para el timestamptz del backend. */
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Fecha local en 'YYYY-MM-DD' desplazada `days` días (negativo = pasado).
 *  Local y no UTC a propósito: el backend interpreta el rango en la timezone
 *  de negocio, así que "hoy" tiene que ser el hoy del usuario. */
export function isoDateOffset(days: number) {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function todayISODate() {
  return isoDateOffset(0)
}
