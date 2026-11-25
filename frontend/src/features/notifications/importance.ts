import {
  AtSign,
  Bug,
  CalendarClock,
  MessageSquareLock,
  PhoneMissed,
  PhoneOff,
  TriangleAlert,
  Zap,
  type LucideIcon,
} from 'lucide-react'
import { NotificationType } from '../automations/public/automationCatalog'
import type { UserNotification } from './types'

/** Qué tan urgente es un aviso. Con un solo color para todo, un recordatorio
 *  de cita pesaba lo mismo que una automatización rota o que alguien pidiendo
 *  ayuda en una nota interna, y lo urgente se perdía entre lo rutinario. */
export type NotificationImportance = 'error' | 'attention' | 'info'

interface ImportanceStyle {
  /** Fondo y color del círculo del ícono. */
  badge: string
  /** Color del texto de la etiqueta. */
  text: string
  /** Franja a la izquierda de la fila: lo urgente se ve al pasar la vista. */
  bar: string
  /** Texto que acompaña al color: el color solo nunca dice el estado. */
  label: string | null
}

export const IMPORTANCE_STYLE: Record<NotificationImportance, ImportanceStyle> = {
  error: { badge: 'bg-danger-soft text-danger-fg', text: 'text-danger-fg', bar: 'border-l-danger', label: 'Error' },
  attention: { badge: 'bg-warning-soft text-warning-fg', text: 'text-warning-fg', bar: 'border-l-warning', label: 'Requiere atención' },
  info: { badge: 'bg-info-soft text-info-fg', text: 'text-info-fg', bar: 'border-l-transparent', label: null },
}

/** El fallo de una automatización viaja como `automation`, igual que el paso
 *  "Notificar" que arma el propio negocio; lo distingue el source_id que le
 *  pone el backend al avisar del fallo (`execution-failed:<id>`). */
function isAutomationFailure(notification: UserNotification): boolean {
  return notification.source_id?.startsWith('execution-failed:') ?? false
}

export function notificationImportance(notification: UserNotification): NotificationImportance {
  switch (notification.notification_type) {
    case NotificationType.ServiceWindowClosed:
    case NotificationType.CallsPaused:
      return 'error'
    case NotificationType.Automation:
      return isAutomationFailure(notification) ? 'error' : 'info'
    case NotificationType.InternalNoteMention:
    case NotificationType.MissedCall:
    case NotificationType.IssueReport:
      return 'attention'
    case NotificationType.Appointment:
      return 'info'
    default:
      return 'info'
  }
}

export function notificationIcon(notification: UserNotification): LucideIcon {
  switch (notification.notification_type) {
    case NotificationType.InternalNoteMention:
      return AtSign
    case NotificationType.Appointment:
      return CalendarClock
    case NotificationType.MissedCall:
      return PhoneMissed
    case NotificationType.CallsPaused:
      return PhoneOff
    case NotificationType.IssueReport:
      return Bug
    case NotificationType.ServiceWindowClosed:
      return MessageSquareLock
    case NotificationType.Automation:
      return isAutomationFailure(notification) ? TriangleAlert : Zap
    default:
      return Zap
  }
}
