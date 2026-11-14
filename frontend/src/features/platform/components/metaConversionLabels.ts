import { AlertCircle, CheckCircle2, Clock, MinusCircle } from 'lucide-react'
import type { MetaConversionItem } from '../types'

// Los tres eventos que la política de datos enumera.
export const EVENT_LABELS: Record<string, string> = {
  LeadSubmitted: 'Lead desde un anuncio',
  QualifiedLead: 'Lead calificado (primera cita)',
  Purchase: 'Compra (adelanto de la cita)',
}

export const STATUS_LABELS: Record<MetaConversionItem['status'], string> = {
  sent: 'Enviado a Meta',
  pending: 'En cola',
  skipped: 'Omitido',
  failed: 'No se pudo enviar',
}

export const STATUS_ICONS: Record<MetaConversionItem['status'], { Icon: typeof Clock; className: string }> = {
  sent: { Icon: CheckCircle2, className: 'text-wa-primary-strong dark:text-wa-primary' },
  failed: { Icon: AlertCircle, className: 'text-red-500 dark:text-red-400' },
  skipped: { Icon: MinusCircle, className: 'text-amber-600 dark:text-amber-400' },
  pending: { Icon: Clock, className: 'text-wa-muted dark:text-wa-muted-dark' },
}

export function eventLabel(name: string) {
  return EVENT_LABELS[name] ?? name
}
