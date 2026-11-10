import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { DashboardPage } from './DashboardPage'
import type { DashboardMetrics, DashboardScope } from '../types'

const requestedScopes: (DashboardScope | null)[] = []

vi.mock('../hooks/useDashboard', () => ({
  useDashboard: (_days: number, scope: DashboardScope | null) => {
    requestedScopes.push(scope)
    return { data: metrics(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() }
  },
}))

// Las etapas son las del negocio; acá alcanza con las que trae una cuenta nueva.
vi.mock('../../leads/public/useLeadStages', async () => {
  const { buildStageCatalog, DEFAULT_LEAD_STAGES } = await import('../../leads/public/leadStageMeta')
  return { useLeadStageCatalog: () => ({ ...buildStageCatalog(DEFAULT_LEAD_STAGES), isLoading: false }) }
})

// Recharts mide el contenedor con ResponsiveContainer y en jsdom eso queda en 0,
// así que el área nunca se dibuja; el doble mantiene el árbol montable.
vi.mock('./primitives', async () => {
  const actual = await vi.importActual<typeof import('./primitives')>('./primitives')
  return { ...actual, TrendChart: ({ label }: { label: string }) => <div>Serie: {label}</div> }
})

// Recharts necesita medir el contenedor y jsdom no mide nada: el gráfico se
// reemplaza por su etiqueta y la tabla equivalente se prueba aparte.
vi.mock('./SalesCharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./SalesCharts')>()
  return { ...actual, SalesTrendChart: () => <div>Serie: ventas</div> }
})

function metrics(): DashboardMetrics {
  return {
    period_days: 30,
    scope: 'mine',
    summary: {
      total_leads: 120, new_leads: 14, awaiting_reply: 3, overdue_tasks: 2, completed_tasks: 9,
      avg_response_minutes: 42, appointments_created: 5, flows_started: 8, flows_active: 2,
      messages_sent: 34, tagged_leads: 90,
    },
    stages: [{ name: 'nuevo', value: 10 }],
    origins: [{ name: 'Instagram', value: 6 }],
    services: [{ name: 'Botox', value: 4 }],
    sellers: [{ name: 'Antonella', value: 60 }, { name: 'Grecia', value: 60 }],
    new_leads_trend: [{ date: '2026-09-20', value: 3 }],
    funnel: [
      { name: 'Leads nuevos', value: 14, rate: 100 },
      { name: 'Cliente', value: 2, rate: 14.3 },
      { name: 'Perdido', value: 1, rate: null },
    ],
    pipeline: {
      stale: [{ name: '+7 días', value: 4 }],
      conversations_open: 5, conversations_closed: 7, avg_close_hours: 20.5,
    },
    sales: {
      currency: 'PEN',
      totals: { count: 3, revenue: 1250, avg_ticket: 416.67, sessions: 7, discount: 40, discount_rate: 3.1, buyers: 3 },
      previous: { count: 2, revenue: 1000, avg_ticket: 500, sessions: 4, discount: 0, discount_rate: 0, buyers: 2 },
      trend: [
        { date: '2026-09-20', count: 1, revenue: 400 },
        { date: '2026-09-21', count: 2, revenue: 850 },
      ],
      previous_trend: [
        { date: '2026-08-21', count: 1, revenue: 500 },
        { date: '2026-08-22', count: 1, revenue: 500 },
      ],
      by_package: [
        {
          package_id: 4, service_name: 'Hollywood Peel - Rostro', package_name: 'x3', sessions: 3,
          count: 2, revenue: 850, avg_ticket: 425, previous_count: 1,
        },
        {
          package_id: 5, service_name: 'Láser', package_name: 'x10', sessions: 10,
          count: 1, revenue: 400, avg_ticket: 400, previous_count: 0,
        },
      ],
      by_service: [
        { service_id: 1, name: 'Hollywood Peel - Rostro', count: 2, revenue: 850 },
        { service_id: 2, name: 'Láser', count: 1, revenue: 400 },
      ],
      by_service_daily: [
        { date: '2026-09-20', service_id: 2, name: 'Láser', count: 1, revenue: 400 },
        { date: '2026-09-21', service_id: 1, name: 'Hollywood Peel - Rostro', count: 2, revenue: 850 },
      ],
      by_seller: [
        { user_id: 2, name: 'Lucía Ramos', count: 2, revenue: 850, avg_ticket: 425, discount_rate: 4.5 },
        { user_id: 3, name: 'Marco Díaz', count: 1, revenue: 400, avg_ticket: 400, discount_rate: 11.1 },
      ],
      recent: [{
        id: 31, lead_id: 'lead-7', lead_name: 'Rosa Quispe', service_name: 'Láser', package_name: 'x6',
        amount: 400, list_price: 450, sold_at: '2026-09-21T15:00:00Z', seller_name: 'Marco Díaz',
      }],
    },
    automations: {
      by_flow: [{
        name: 'Recordatorio de Yape', rule_id: 12, trigger_type: 'manual', value: 8,
        completed: 5, failed: 1, skipped: 1, active: 1, last_at: '2026-09-20T15:00:00Z',
      }],
      by_actor: [{ name: 'Antonella', value: 8 }],
      by_source: [{ name: 'Iniciado a mano', value: 8 }],
      by_trigger: [{ name: 'manual', value: 8 }],
      trend: [{ date: '2026-09-20', value: 8 }],
      failures: { total: 8, failed: 1, rate: 12.5, top_errors: [{ name: 'ventana cerrada', value: 1 }] },
      active_now: { scheduled: 1, running: 0, paused: 1 },
    },
    tags: {
      coverage: { total: 120, tagged: 90, untagged: 30, rate: 75 },
      top: [{ id: 4, name: 'Interesado', color: '#16a34a', value: 40 }],
      by_user: [{ name: 'Antonella', value: 25 }],
      trend: [{ date: '2026-09-20', value: 5 }],
    },
    appointments: {
      by_status: [{ name: 'Registrada', value: 5 }],
      by_treatment: [{ name: 'Limpieza facial', value: 3 }],
      by_treatment_daily: [
        { date: '2026-09-20', key: 'hifu12d', name: 'Hifu12D', count: 3 },
        { date: '2026-09-21', key: 'hifu12d', name: 'HIFU 12D', count: 1 },
        { date: '2026-09-21', key: 'limpiezafacial', name: 'Limpieza Facial', count: 4 },
      ],
      by_user: [{ name: 'Grecia', value: 5 }],
      by_owner: [{ name: 'Antonella', value: 4 }, { name: 'Sin lead vinculado', value: 1 }],
      trend: [{ date: '2026-09-20', value: 5 }, { date: '2026-09-21', value: 3 }],
      lost_reasons: [{ name: 'Precio', value: 2 }],
      upcoming: [
        { id: 1, lead_id: 'lead-1', name: 'Ana Pérez', date: '2026-09-22', time: '14:00', treatment: 'Botox' },
        // Sin lead: el teléfono no identificó a ninguno, o identificó a varios.
        { id: 2, lead_id: null, name: 'Luis Rojas', date: '2026-09-23', time: '09:30', treatment: null },
      ],
      no_shows: { leads: 2, total: 3 },
      linkage: { total: 5, linked: 4, unlinked: 1, rate: 80 },
    },
    activity: {
      trend: [{ date: '2026-09-20', value: 12 }],
      by_type: [{ name: 'Etiquetas puestas', value: 12 }],
      by_user: [{ name: 'Antonella', value: 12 }],
      messages: {
        trend: [{ date: '2026-09-20', value: 34 }],
        by_user: [{ name: 'Antonella', value: 34 }],
      },
    },
    generated_at: '2026-09-21T12:00:00Z',
  }
}

function renderDashboard(isAdmin = false) {
  requestedScopes.length = 0
  const onOpenFlows = vi.fn()
  const onOpenChat = vi.fn()
  const onFilterChats = vi.fn()
  render(
    <DashboardPage
      isAdmin={isAdmin}
      onOpenTasks={vi.fn()}
      onOpenFlows={onOpenFlows}
      onOpenChat={onOpenChat}
      onFilterChats={onFilterChats}
    />,
  )
  return { onOpenFlows, onOpenChat, onFilterChats }
}

describe('DashboardPage', () => {
  it('abre en lo propio para un vendedor y en el equipo para un admin', () => {
    renderDashboard(false)
    expect(requestedScopes.at(-1)).toBe('mine')

    renderDashboard(true)
    expect(requestedScopes.at(-1)).toBe('team')
  })

  it('muestra las cifras que el vendedor vino a buscar', () => {
    renderDashboard()

    expect(screen.getByText('Citas registradas')).toBeInTheDocument()
    expect(screen.getByText('Flujos que activé')).toBeInTheDocument()
    expect(screen.getByText('2 siguen activos')).toBeInTheDocument()
    expect(screen.getByText('Leads etiquetados')).toBeInTheDocument()
    expect(screen.getByText('75% de cobertura')).toBeInTheDocument()
  })

  it('reparte los paneles en pestañas y solo muestra la activa', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await user.click(screen.getByRole('tab', { name: 'Flujos' }))
    expect(screen.getByText('Recordatorio de Yape')).toBeInTheDocument()
    expect(screen.getByText('Quién activó flujos a mano')).toBeInTheDocument()
    expect(screen.queryByText('Citas registradas')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Etiquetas' }))
    expect(screen.getByText('Cobertura de etiquetado')).toBeInTheDocument()
    expect(screen.getByText('Interesado')).toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: 'Embudo y citas' }))
    expect(screen.getByText('Embudo de conversión')).toBeInTheDocument()
    expect(screen.getByText('Razones de pérdida')).toBeInTheDocument()
  })

  it('desglosa cada flujo por estado con la cifra visible, no solo con color', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole('tab', { name: 'Flujos' }))

    // La leyenda nombra los cuatro estados: el color no puede ser el único
    // indicio de qué es cada segmento.
    for (const label of ['Completados', 'Activos', 'Omitidos', 'Fallidos']) {
      expect(screen.getByText(label)).toBeInTheDocument()
    }
    expect(screen.getByText('1 ejecuciones no llegaron a enviarse')).toBeInTheDocument()
  })

  it('muestra las ventas en la moneda del negocio y contra el período anterior', () => {
    renderDashboard(true)

    // El total y el ticket llevan la moneda del perfil; el cambio dice la
    // dirección con flecha y signo, no solo con color.
    expect(screen.getByText(/S\/\s?1,250/)).toBeInTheDocument()
    expect(screen.getByText('▲ +25% vs. período anterior')).toBeInTheDocument()
    expect(screen.getByText('▲ +50% vs. período anterior')).toBeInTheDocument()
    expect(screen.getByText('▼ -17% vs. período anterior')).toBeInTheDocument()
    // Los paquetes se cuentan por compras aunque el backend los ordene por ingresos.
    expect(screen.getByText('Hollywood Peel - Rostro · x3')).toBeInTheDocument()
    expect(screen.getByText('Láser · x10')).toBeInTheDocument()
  })

  it('lleva de Resumen a la pestaña de ventas', async () => {
    const user = userEvent.setup()
    renderDashboard(true)

    await user.click(screen.getByRole('button', { name: 'Ver ventas' }))
    expect(screen.getByRole('tab', { name: 'Ventas' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Monto vendido')).toBeInTheDocument()
  })

  it('compara cada cifra de ventas con el período anterior', async () => {
    const user = userEvent.setup()
    renderDashboard(true)
    await user.click(screen.getByRole('tab', { name: 'Ventas' }))

    expect(screen.getByText('3 clientes')).toBeInTheDocument()
    // Compras +50 %, ingresos +25 %, ticket -17 %, sesiones +75 %.
    for (const label of ['▲ +50%', '▲ +25%', '▼ -17%', '▲ +75%']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    // Un descuento que sube se dice en puntos, no en porcentaje de porcentaje.
    expect(screen.getByText('▲ +3.1 pts')).toBeInTheDocument()
  })

  it('ordena los paquetes por la columna elegida y marca los que antes no se vendían', async () => {
    const user = userEvent.setup()
    renderDashboard(true)
    await user.click(screen.getByRole('tab', { name: 'Ventas' }))

    const table = screen.getAllByRole('table')[0]
    const firstPackage = () => within(table).getAllByRole('row')[1]
    expect(within(firstPackage()).getByText('Hollywood Peel - Rostro')).toBeInTheDocument()
    expect(within(table).getByText('Nuevo')).toBeInTheDocument()

    // Láser x10 vende menos compras pero trae diez sesiones por compra.
    await user.click(within(table).getByRole('button', { name: /Sesiones/ }))
    expect(within(firstPackage()).getByText('Láser')).toBeInTheDocument()
    expect(within(table).getByRole('columnheader', { name: /Sesiones/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('marca al vendedor con descuento alto y abre el chat de una compra reciente', async () => {
    const user = userEvent.setup()
    const { onOpenChat } = renderDashboard(true)
    await user.click(screen.getByRole('tab', { name: 'Ventas' }))

    expect(screen.getByTitle('Descuento promedio por encima del 8%')).toHaveTextContent('11.1%')
    expect(screen.getByText(/Lista S\/\s?450/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Rosa Quispe/ }))
    expect(onOpenChat).toHaveBeenCalledWith('lead-7')
  })

  it('desglosa las ventas por tratamiento con su participación y una tabla', async () => {
    const user = userEvent.setup()
    renderDashboard(true)
    await user.click(screen.getByRole('tab', { name: 'Ventas' }))

    expect(screen.getByRole('heading', { name: 'Por tratamiento' })).toBeInTheDocument()
    expect(screen.getByText('Hollywood Peel - Rostro fue el más vendido: 2, el 67% del período.')).toBeInTheDocument()
    // La participación se lee en texto, no solo en la torta.
    const shareList = screen.getByText('Participación del período').parentElement!
    expect(within(shareList).getByText('67%')).toBeInTheDocument()
    expect(within(shareList).getByText('33%')).toBeInTheDocument()

    // Ocultar un tratamiento lo saca de la tabla y del reparto.
    await user.click(screen.getByRole('button', { name: 'Láser' }))
    expect(screen.getByRole('button', { name: 'Láser' })).toHaveAttribute('aria-pressed', 'false')
    expect(within(shareList).getByText('100%')).toBeInTheDocument()
  })

  it('cuenta las citas agendadas por tratamiento cuando se elige esa fuente', async () => {
    const user = userEvent.setup()
    renderDashboard(true)
    await user.click(screen.getByRole('tab', { name: 'Ventas' }))

    await user.click(screen.getByRole('button', { name: 'Citas agendadas' }))
    // Las variantes de escritura cuentan juntas; con citas no hay medida en plata.
    expect(screen.getByText('Hifu12D fue el más agendado: 4, el 50% del período.')).toBeInTheDocument()
    const panel = screen.getByRole('heading', { name: 'Por tratamiento' }).closest('section')!
    expect(within(panel).queryByRole('button', { name: 'Ingresos' })).toBeNull()
  })

  it('lleva de una cita próxima al chat del lead', async () => {
    const user = userEvent.setup()
    const { onOpenChat } = renderDashboard()

    await user.click(screen.getByRole('button', { name: /Ana Pérez/ }))
    expect(onOpenChat).toHaveBeenCalledWith('lead-1')
  })

  it('lista la cita sin lead vinculado, pero sin ofrecer un chat que abrir', () => {
    renderDashboard()

    expect(screen.getByText('Luis Rojas')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Luis Rojas/ })).not.toBeInTheDocument()
  })

  it('cuenta los mensajes que el vendedor envió desde la app', () => {
    renderDashboard()

    expect(screen.getByText('Mensajes enviados')).toBeInTheDocument()
    // El KPI aclara de dónde sale la cifra: los enviados desde el celular del
    // vendedor llegan sin autor y no se cuentan.
    expect(screen.getByText('Desde la app · Últimos 30 días')).toBeInTheDocument()
    expect(screen.getByText('Quién manda más mensajes')).toBeInTheDocument()
  })

  it('avisa cuántas citas no llegaron a un lead', async () => {
    const user = userEvent.setup()
    renderDashboard()
    await user.click(screen.getByRole('tab', { name: 'Embudo y citas' }))

    expect(screen.getByText('Citas ligadas a un lead')).toBeInTheDocument()
    expect(screen.getByText('80% del total')).toBeInTheDocument()
    expect(screen.getByText('Revisa el teléfono')).toBeInTheDocument()
    expect(screen.getByText('De quién es el lead de la cita')).toBeInTheDocument()
  })

  it('cambia el alcance cuando el vendedor pide ver al equipo', async () => {
    const user = userEvent.setup()
    renderDashboard()

    await user.click(screen.getByLabelText('Alcance de las métricas'))
    await user.click(screen.getByRole('option', { name: 'Todo el equipo' }))
    expect(requestedScopes.at(-1)).toBe('team')
  })
})
