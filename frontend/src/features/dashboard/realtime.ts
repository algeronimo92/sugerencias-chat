/**
 * Tiempo real del dashboard: las métricas se recalculan cuando cambia algo que
 * cuentan (mensajes, leads, etapas y tareas).
 */

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import type { ChatsUpdateReason } from '../../realtime/socketEvents'
import { dashboardKeys } from './keys'

/** Cambios que cuentan en las métricas del dashboard. */
const DASHBOARD_REASONS: ReadonlySet<ChatsUpdateReason> = new Set(['inbound_message', 'outbound_message', 'lead_created', 'stage_changed'])

export function createDashboardRealtime(): RealtimeModule {
  return {
    handlers: {
      chats_updated: (event, { queryClient }) => {
        if (event.reason && DASHBOARD_REASONS.has(event.reason)) invalidate(queryClient, dashboardKeys.all)
      },
      tasks_updated: (_event, { queryClient }) => invalidate(queryClient, dashboardKeys.all),
      // Renombres, colores u orden del embudo: el dashboard rotula y ordena con
      // las etapas.
      lead_stages_updated: (_event, { queryClient }) => invalidate(queryClient, dashboardKeys.all),
    },
    resync: [dashboardKeys.all],
  }
}
