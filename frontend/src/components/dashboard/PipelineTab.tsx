import type { ChatFilters, DashboardMetrics } from '../../types'
import { isLeadStage } from '../../types'
import { STAGE_LABELS, formatNumber } from './format'
import { BarList, FunnelList, Panel, StatGrid, TrendChart } from './primitives'

interface Props {
  data: DashboardMetrics
  days: number
  isMine: boolean
  onFilterChats: (filters: Partial<ChatFilters>) => void
}

export function PipelineTab({ data, days, isMine, onFilterChats }: Props) {
  const { appointments } = data
  const period = `Últimos ${days} días`
  const scopeLabel = isMine ? 'Mis leads' : 'Todo el equipo'

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Panel
        title="Embudo de conversión"
        subtitle={`Leads creados en el período · ${scopeLabel}`}
      >
        <FunnelList steps={data.funnel} />
      </Panel>

      <Panel title="Leads por etapa" subtitle={scopeLabel}>
        <BarList
          items={data.stages}
          labels={STAGE_LABELS}
          onSelect={(stage) => {
            if (isLeadStage(stage)) onFilterChats({ stages: [stage] })
          }}
        />
      </Panel>

      <Panel title="Salud del agendamiento" subtitle={`Cómo terminó cada registro de cita · ${period}`}>
        <BarList items={appointments.by_status} emptyLabel="Sin citas registradas en el período" />
        <div className="mt-4">
          <StatGrid
            stats={[
              {
                label: 'Citas ligadas a un lead',
                value: formatNumber(appointments.linkage.linked),
                hint: appointments.linkage.rate != null ? `${appointments.linkage.rate}% del total` : undefined,
              },
              {
                label: 'Sin lead',
                value: formatNumber(appointments.linkage.unlinked),
                hint: appointments.linkage.unlinked > 0 ? 'Revisá el teléfono' : undefined,
              },
              { label: 'Leads con no-show', value: formatNumber(appointments.no_shows.leads) },
              { label: 'No-shows acumulados', value: formatNumber(appointments.no_shows.total) },
            ]}
          />
        </div>
      </Panel>

      <Panel title="Tratamientos más agendados" subtitle={period}>
        <BarList items={appointments.by_treatment} emptyLabel="Sin citas registradas en el período" />
      </Panel>

      <Panel title="Citas registradas por día" className="lg:col-span-2">
        <TrendChart points={appointments.trend} label="Citas" />
      </Panel>

      <Panel title="Quién registra las citas" subtitle={`Ranking del equipo · ${period}`}>
        <BarList items={appointments.by_user} emptyLabel="Nadie registró citas en el período" />
      </Panel>

      <Panel
        title="De quién es el lead de la cita"
        subtitle="La cartera a la que pertenece, aunque otra persona haya llenado el formulario"
      >
        <BarList items={appointments.by_owner} emptyLabel="Sin citas registradas en el período" />
      </Panel>

      {/* Sin filtro al hacer clic: el ranking viene por nombre y la lista de
          chats filtra por id de vendedor. */}
      <Panel title="Carga por vendedor" subtitle="Leads asignados, ranking del equipo">
        <BarList items={data.sellers} />
      </Panel>

      <Panel title="Principales orígenes" subtitle={scopeLabel}>
        <BarList items={data.origins} onSelect={(origin) => onFilterChats({ origin })} />
      </Panel>

      <Panel title="Servicios de interés" subtitle={scopeLabel}>
        <BarList items={data.services} onSelect={(service) => onFilterChats({ service })} />
      </Panel>

      <Panel title="Razones de pérdida" subtitle={`Leads marcados como perdidos · ${scopeLabel}`} className="lg:col-span-2">
        <BarList items={appointments.lost_reasons} emptyLabel="Sin leads perdidos" />
      </Panel>
    </div>
  )
}
