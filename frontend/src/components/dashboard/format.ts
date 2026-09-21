/** Etiquetas y formato de los paneles. Vive aparte de `primitives.tsx` porque
 *  mezclar constantes con componentes en un mismo archivo rompe el fast refresh. */

export const STAGE_LABELS: Record<string, string> = {
  nuevo: 'Nuevo',
  en_diagnostico: 'En diagnóstico',
  calificado: 'Calificado',
  oferta_presentada: 'Oferta presentada',
  en_objecion: 'En objeción',
  agendado: 'Agendado',
  cliente_activo: 'Cliente activo',
  postventa: 'Postventa',
  en_seguimiento: 'En seguimiento',
  en_nutricion: 'En nutrición',
  perdido: 'Perdido',
  descalificado: 'Descalificado',
  baja: 'Baja',
}

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
