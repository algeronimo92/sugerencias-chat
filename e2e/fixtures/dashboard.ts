import type { ApiResponse } from '../../frontend/src/shared/http/contract'

type Dashboard = ApiResponse<'/api/dashboard', 'get'>

/** Un dashboard sin movimiento: alcanza para dibujar la cabecera y las
 * pestañas. Las pruebas de los gráficos viven en Vitest. */
export function emptyDashboard(days = 30): Dashboard {
  const separationTotals = { count: 0, amount: 0, with_deposit: 0, avg_deposit: null, clients: 0 }
  return {
    period_days: days,
    scope: 'team',
    summary: {
      total_leads: 0, new_leads: 0, awaiting_reply: 0, overdue_tasks: 0, completed_tasks: 0,
      avg_response_minutes: null, appointments_created: 0, flows_started: 0, flows_active: 0,
      messages_sent: 0, tagged_leads: 0,
    },
    stages: [],
    origins: [],
    services: [],
    sellers: [],
    new_leads_trend: [],
    funnel: [],
    pipeline: { stale: [], conversations_open: 0, conversations_closed: 0, avg_close_hours: null },
    currency: 'PEN',
    sales: {
      currency: 'PEN',
      totals: { count: 0, revenue: 0, avg_ticket: null, sessions: 0, discount: 0, discount_rate: null, buyers: 0 },
      previous: null, trend: [], previous_trend: [], by_package: [], by_service: [], by_service_daily: [], by_seller: [], recent: [],
    },
    automations: {
      by_flow: [],
      origin_totals: { manual: 0, automatic: 0, manual_chained: 0, automatic_chained: 0 },
      by_actor: [], by_source: [], by_trigger: [], trend: [], trend_manual: [], trend_automatic: [],
      failures: { total: 0, failed: 0, rate: null, top_errors: [] },
      active_now: { scheduled: 0, running: 0, paused: 0 },
    },
    tags: { coverage: { total: 0, tagged: 0, untagged: 0, rate: null }, top: [], by_user: [], trend: [] },
    appointments: {
      by_status: [], by_user: [], by_owner: [], by_treatment: [], by_treatment_daily: [],
      separations: {
        totals: separationTotals, previous: null, trend: [], previous_trend: [], by_seller: [], by_owner: [], recent: [],
      },
      trend: [], lost_reasons: [], upcoming: [],
      no_shows: { leads: 0, total: 0 },
      linkage: { total: 0, linked: 0, unlinked: 0, rate: null },
    },
    activity: { trend: [], by_type: [], by_user: [], messages: { trend: [], by_user: [], by_origin: [] } },
    hours: {
      slot_hours: 2, engagement_window_hours: 24, weekday_occurrences: [4, 4, 4, 4, 4, 5, 5],
      start_date: '2026-10-16', person_peaks: { messages: 0, flows_manual: 0 }, people: [], cells: [],
    },
    generated_at: '2026-11-14T15:00:00Z',
  }
}
