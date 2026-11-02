/** Tiempo real del centro de notificaciones: el aviso, a dónde lleva y la
 * alerta de mención en una nota interna. */

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import type { CreatedNotification } from '../../realtime/socketEvents'
import { NotificationType } from '../automations/public/automationCatalog'
import { notificationKeys } from './keys'

const PREVIEW_MAX_LENGTH = 140

function preview(text: string) {
  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH - 3)}...` : text
}

const DESTINATIONS: Record<string, (notification: CreatedNotification) => string | null> = {
  [NotificationType.IssueReport]: notification => (
    notification.metadata?.issue_report_id ? `/reports?report=${notification.metadata.issue_report_id}` : '/reports'
  ),
  [NotificationType.Appointment]: () => '/citas/nueva',
}

export function createNotificationsRealtime(): RealtimeModule {
  return {
    handlers: {
      notifications_updated: (_event, { queryClient }) => invalidate(queryClient, notificationKeys.all),
      notification_created: ({ notification }, { queryClient, navigate, notify, onInternalMention }) => {
        invalidate(queryClient, notificationKeys.all)
        notify(
          notification.title,
          preview(notification.body),
          () => {
            const destination = DESTINATIONS[notification.notification_type]?.(notification)
              ?? (notification.lead_id ? `/chat/${notification.lead_id}` : null)
            if (destination) navigate(destination)
          },
          { force: true, tag: `notification-${notification.id}` },
        )
        if (notification.notification_type === NotificationType.InternalNoteMention && notification.lead_id) {
          onInternalMention({
            notificationId: notification.id,
            leadId: notification.lead_id,
            authorName: notification.metadata?.author_name ?? 'Un usuario',
            content: notification.body,
          })
        }
      },
    },
    resync: [notificationKeys.all],
  }
}
