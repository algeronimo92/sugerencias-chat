/** Etiquetas y formato de los paneles. Vive aparte de `primitives.tsx` porque
 *  mezclar constantes con componentes en un mismo archivo rompe el fast refresh. */

// Estos son los buckets "sin dato" que arma el backend (COALESCE) para que
// las barras nunca queden vacías; no son valores reales de lead, así que no
// tiene sentido ofrecerlos como filtro.
export const PLACEHOLDER_NAMES = new Set(['Sin origen', 'Sin servicio', 'Sin asignar', 'Sin razón'])

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return 'Sin datos'
  if (minutes < 60) return `${minutes.toLocaleString('es-PE')} min`
  return `${(minutes / 60).toLocaleString('es-PE', { maximumFractionDigits: 1 })} h`
}

export function formatRelativeTime(iso: string): string {
  const diffMinutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  if (diffMinutes < 1) return 'hace un momento'
  if (diffMinutes < 60) return `hace ${diffMinutes} min`
  return `hace ${Math.round(diffMinutes / 60)} h`
}

export function formatNumber(value: number): string {
  return value.toLocaleString('es-PE')
}

export function formatDayLabel(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString('es-PE')
}

export function formatShortDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-PE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Importes sin moneda (la del negocio vive en el perfil IA), sin decimales
 *  de más: "1250" o "1250.5". */
export function formatAmount(value: string | number | null): string {
  if (value == null) return 'Sin datos'
  return Number(value).toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
}

/** Importe con la moneda del negocio cuando la hay. El backend solo manda
 *  códigos ISO, pero si el navegador no conoce alguno se cae al número solo
 *  en vez de romper el panel. */
export function formatMoney(value: number | null, currency: string | null): string {
  if (value == null) return 'Sin datos'
  if (currency) {
    try {
      return value.toLocaleString('es-PE', { style: 'currency', currency, maximumFractionDigits: 0 })
    } catch {
      // RangeError por un código que este navegador no tiene: sigue abajo.
    }
  }
  return formatAmount(value)
}

/** Cambio contra el período anterior, con flecha y signo para que la
 *  dirección no dependa del color. Sin base (null o 0) no hay porcentaje que
 *  mostrar: un "+100 %" sobre cero no dice nada. */
export function formatChange(current: number | null, previous: number | null | undefined): string {
  if (current == null || !previous) return 'Sin período anterior para comparar'
  const change = Math.round(((current - previous) / previous) * 100)
  if (change === 0) return 'Igual que el período anterior'
  return `${change > 0 ? '▲ +' : '▼ '}${change}% vs. período anterior`
}
