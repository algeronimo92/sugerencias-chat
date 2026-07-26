/** Formato que espera un <input type="datetime-local">: hora local, sin zona.
 * El viaje de vuelta es `new Date(valor).toISOString()`, que reinterpreta esa
 * hora local en UTC para el timestamptz del backend. */
export function toLocalInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
