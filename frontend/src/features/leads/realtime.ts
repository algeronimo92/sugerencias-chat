/**
 * Tiempo real de leads: la actividad del lead, el kanban, el dashboard y las
 * etapas.
 */

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import type { ChatsUpdateReason } from '../../realtime/socketEvents'
import { dashboardKeys, kanbanKeys, leadKeys, stageKeys } from './keys'

/** Cambios que mueven tarjetas del kanban. */
const KANBAN_REASONS: ReadonlySet<ChatsUpdateReason> = new Set(['lead_created', 'lead_updated', 'stage_changed', 'tag_changed'])
/** Cambios que cuentan en las métricas del dashboard. */
const DASHBOARD_REASONS: ReadonlySet<ChatsUpdateReason> = new Set(['inbound_message', 'outbound_message', 'lead_created', 'stage_changed'])

export function createLeadsRealtime(): RealtimeModule {
  return {
    handlers: {
      chats_updated: (event, { queryClient }) => {
        const changedChatId = event.chat_id ?? event.latest_message?.chat_id
        const reason = event.reason
        if (changedChatId) {
          // Leer un chat o un acuse de entrega no dejan rastro en la actividad.
          if (reason !== 'message_status' && reason !== 'read') invalidate(queryClient, leadKeys.activity(changedChatId))
        } else {
          invalidate(queryClient, leadKeys.activityAll)
        }
        if (!changedChatId || (reason && KANBAN_REASONS.has(reason))) invalidate(queryClient, kanbanKeys.all)
        if (reason && DASHBOARD_REASONS.has(reason)) invalidate(queryClient, dashboardKeys.all)
      },
      internal_notes_updated: (event, { queryClient }) => invalidate(queryClient, leadKeys.activity(event.lead_id)),
      // Las tareas cuentan en el dashboard.
      tasks_updated: (_event, { queryClient }) => invalidate(queryClient, dashboardKeys.all),
      // Renombres, colores u orden del embudo: el kanban y el dashboard también
      // rotulan y ordenan con ellas.
      lead_stages_updated: (_event, { queryClient }) => invalidate(queryClient, stageKeys.all, kanbanKeys.all, dashboardKeys.all),
    },
    resync: [kanbanKeys.all, dashboardKeys.all],
  }
}
