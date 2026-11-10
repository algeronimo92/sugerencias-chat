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

/** Un punto de una serie diaria con cantidad y monto (separaciones). */
export interface DashboardAmountPoint {
  date: string
  count: number
  revenue: number
}

export interface DashboardSeparationTotals {
  count: number
  /** Suma de adelantos. */
  amount: number
  with_deposit: number
  /** Promedio entre las que dejaron adelanto. */
  avg_deposit: number | null
  clients: number
}

export interface DashboardSeparationRankRow {
  name: string
  count: number
  amount: number
  with_deposit: number
}

export interface DashboardSeparations {
  totals: DashboardSeparationTotals
  /** null si en la ventana anterior no hubo separaciones. */
  previous: DashboardSeparationTotals | null
  trend: { date: string; count: number; amount: number }[]
  previous_trend: { date: string; count: number; amount: number }[]
  /** Ranking del equipo por quién registró la separación; llega igual en los dos scopes. */
  by_seller: DashboardSeparationRankRow[]
  /** Ranking del equipo por la vendedora asignada a la clienta en el CRM. */
  by_owner: DashboardSeparationRankRow[]
  recent: {
    id: number
    /** null cuando la cita no quedó ligada a un lead: no hay chat que abrir. */
    lead_id: string | null
    name: string
    treatment: string
    amount: number
    date: string
    time: string
    created_at: string
    seller_name: string
  }[]
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
  /** Código ISO 4217 del negocio, o null si no lo configuró: los importes
   *  (adelantos) van entonces sin moneda. */
  currency: string | null
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
    /** Citas agendadas por tratamiento y día (sin duplicadas, fallidas ni de
     *  prueba). `key` junta las variantes de escritura del formulario. */
    by_treatment_daily: { date: string; key: string; name: string; count: number; amount: number }[]
    /** La venta del negocio: citas agendadas con su adelanto. */
    separations: DashboardSeparations
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
