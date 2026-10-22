export interface DashboardMetricItem {
  name: string
  value: number
}

export interface DashboardPoint {
  date: string
  value: number
}

/** 'mine' = los leads y los flujos del propio vendedor; 'team' = todo. Los
 *  rankings comparativos vienen en los dos casos. */
export type DashboardScope = 'mine' | 'team'

export interface DashboardFunnelStep extends DashboardMetricItem {
  /** Porcentaje sobre los leads creados en el período, o null si no hubo. */
  rate: number | null
}

export interface DashboardFlowRow extends DashboardMetricItem {
  rule_id: number
  trigger_type: string
  completed: number
  failed: number
  skipped: number
  active: number
  last_at: string | null
}

export interface DashboardTagRow extends DashboardMetricItem {
  id: number
  color: string
}

export interface DashboardUpcomingAppointment {
  id: number
  /** null cuando el teléfono de la cita no identificó a un único lead: se
   *  muestra igual, pero sin enlace al chat. */
  lead_id: string | null
  name: string
  date: string
  /** Tal como se registró en el formulario; es texto, no un timestamp. */
  time: string
  treatment: string | null
}

export interface DashboardMetrics {
  period_days: number
  scope: DashboardScope
  summary: {
    total_leads: number
    new_leads: number
    awaiting_reply: number
    overdue_tasks: number
    completed_tasks: number
    avg_response_minutes: number | null
    appointments_created: number
    flows_started: number
    flows_active: number
    /** Solo los mensajes con autor conocido, es decir los enviados desde la app.
     *  Un mensaje escrito desde el celular del vendedor llega sin autor. */
    messages_sent: number
    tagged_leads: number
  }
  stages: DashboardMetricItem[]
  origins: DashboardMetricItem[]
  services: DashboardMetricItem[]
  sellers: DashboardMetricItem[]
  new_leads_trend: DashboardPoint[]
  funnel: DashboardFunnelStep[]
  pipeline: {
    stale: DashboardMetricItem[]
    conversations_open: number
    conversations_closed: number
    avg_close_hours: number | null
  }
  automations: {
    by_flow: DashboardFlowRow[]
    by_actor: DashboardMetricItem[]
    by_source: DashboardMetricItem[]
    by_trigger: DashboardMetricItem[]
    trend: DashboardPoint[]
    failures: {
      total: number
      failed: number
      rate: number | null
      top_errors: DashboardMetricItem[]
    }
    active_now: Record<string, number>
  }
  tags: {
    coverage: { total: number; tagged: number; untagged: number; rate: number | null }
    top: DashboardTagRow[]
    by_user: DashboardMetricItem[]
    trend: DashboardPoint[]
  }
  appointments: {
    by_status: DashboardMetricItem[]
    /** Quién registró la cita. */
    by_user: DashboardMetricItem[]
    /** De quién es el lead al que quedó vinculada. */
    by_owner: DashboardMetricItem[]
    by_treatment: DashboardMetricItem[]
    trend: DashboardPoint[]
    lost_reasons: DashboardMetricItem[]
    upcoming: DashboardUpcomingAppointment[]
    no_shows: { leads: number; total: number }
    /** Cuántas citas quedaron colgadas de un lead; una tasa baja avisa que los
     *  teléfonos del formulario no coinciden con las fichas del CRM. */
    linkage: { total: number; linked: number; unlinked: number; rate: number | null }
  }
  activity: {
    trend: DashboardPoint[]
    by_type: DashboardMetricItem[]
    by_user: DashboardMetricItem[]
    messages: { trend: DashboardPoint[]; by_user: DashboardMetricItem[] }
  }
  generated_at: string
}
