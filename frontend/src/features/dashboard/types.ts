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

export interface DashboardSalesTotals {
  count: number
  /** Lo cobrado, no el precio de lista. */
  revenue: number
  avg_ticket: number | null
  sessions: number
  discount: number
  /** Porcentaje del descuento sobre el precio de lista. */
  discount_rate: number | null
  buyers: number
}

export interface DashboardSalesPoint {
  date: string
  count: number
  revenue: number
}

export interface DashboardSalesPackage {
  /** null cuando el paquete ya no está en el catálogo. */
  package_id: number | null
  service_name: string
  package_name: string
  sessions: number
  count: number
  revenue: number
  avg_ticket: number | null
  /** Compras del mismo paquete en la ventana anterior; 0 si no vendía. */
  previous_count: number
}

export interface DashboardSales {
  /** Código ISO 4217 del negocio, o null si no lo configuró. */
  currency: string | null
  totals: DashboardSalesTotals
  /** null si en la ventana anterior no hubo ventas. */
  previous: DashboardSalesTotals | null
  trend: DashboardSalesPoint[]
  /** Alineada con `trend` por posición. */
  previous_trend: DashboardSalesPoint[]
  by_package: DashboardSalesPackage[]
  by_service: { service_id: number | null; name: string; count: number; revenue: number }[]
  /** Lo mismo que by_service, por día; solo los días con ventas. */
  by_service_daily: { date: string; service_id: number | null; name: string; count: number; revenue: number }[]
  /** Ranking del equipo: llega igual en los dos scopes. */
  by_seller: {
    user_id: number | null
    name: string
    count: number
    revenue: number
    avg_ticket: number | null
    discount_rate: number | null
  }[]
  recent: {
    id: number
    lead_id: string
    lead_name: string
    service_name: string
    package_name: string
    amount: number
    list_price: number
    sold_at: string
    seller_name: string
  }[]
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

export interface DashboardSeparations {
  totals: DashboardSeparationTotals
  /** null si en la ventana anterior no hubo separaciones. */
  previous: DashboardSeparationTotals | null
  trend: { date: string; count: number; amount: number }[]
  previous_trend: { date: string; count: number; amount: number }[]
  /** Ranking del equipo: llega igual en los dos scopes. */
  by_seller: { name: string; count: number; amount: number; with_deposit: number }[]
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
  /** Compras registradas en el período (por fecha de venta), contra la
   *  ventana anterior de la misma duración. */
  sales: DashboardSales
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
