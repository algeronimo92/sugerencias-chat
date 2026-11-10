import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { DashboardPage } from './DashboardPage'
import type { DashboardMetrics, DashboardScope } from '../types'

const requestedScopes: (DashboardScope | null)[] = []
const requests: { days: number; scope: DashboardScope | null; sellerId: number | null }[] = []

vi.mock('../hooks/useDashboard', () => ({
  useDashboard: (days: number, scope: DashboardScope | null, sellerId: number | null = null) => {
    requestedScopes.push(scope)
    requests.push({ days, scope, sellerId })
    return { data: metrics(), isLoading: false, isFetching: false, error: null, refetch: vi.fn() }
  },
}))

// Las vendedoras que el admin puede elegir para mirar sus métricas.
vi.mock('../../platform/public/useUsers', () => ({
  useSellers: () => ({ data: [{ id: 2, name: 'Lucía Ramos', role: 'vendedor' }, { id: 3, name: 'Marco Díaz', role: 'vendedor' }] }),
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
    currency: 'PEN',
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
        { date: '2026-09-20', key: 'hifu12d', name: 'Hifu12D', count: 3, amount: 300 },
        { date: '2026-09-21', key: 'hifu12d', name: 'HIFU 12D', count: 1, amount: 100 },
        { date: '2026-09-21', key: 'limpiezafacial', name: 'Limpieza Facial', count: 4, amount: 200 },
      ],
      separations: {
        totals: { count: 3, amount: 250, with_deposit: 2, avg_deposit: 125, clients: 3 },
        previous: { count: 2, amount: 200, with_deposit: 2, avg_deposit: 100, clients: 2 },
        trend: [{ date: '2026-09-20', count: 1, amount: 100 }, { date: '2026-09-21', count: 2, amount: 150 }],
        previous_trend: [{ date: '2026-08-21', count: 1, amount: 100 }, { date: '2026-08-22', count: 1, amount: 100 }],
        by_seller: [{ name: 'Grecia', count: 3, amount: 250, with_deposit: 2 }],
        recent: [
          {
            id: 9, lead_id: 'lead-9', name: 'Ana Torres', treatment: 'Hifu12D', amount: 150, date: '2026-10-01',
            time: '10:00', created_at: '2026-09-21T15:00:00Z', seller_name: 'Grecia',
          },
          {
            id: 10, lead_id: null, name: 'Sin Ficha', treatment: 'Consulta', amount: 0, date: '2026-10-02',
            time: '11:00', created_at: '2026-09-21T16:00:00Z', seller_name: 'Grecia',
          },
        ],
      },
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

function CurrentQuery() {
  return <output data-testid="query">{useLocation().search}</output>
}

function renderDashboard(isAdmin = false, url = '/dashboard') {
  requestedScopes.length = 0
  requests.length = 0
  const onOpenFlows = vi.fn()
  const onOpenChat = vi.fn()
  const onFilterChats = vi.fn()
  const view = render(
    <MemoryRouter initialEntries={[url]}>
      <DashboardPage
        isAdmin={isAdmin}
        onOpenTasks={vi.fn()}
        onOpenFlows={onOpenFlows}
        onOpenChat={onOpenChat}
        onFilterChats={onFilterChats}
      />
      <CurrentQuery />
    </MemoryRouter>,
  )
  return { onOpenFlows, onOpenChat, onFilterChats, unmount: view.unmount }
}

describe('DashboardPage', () => {
  // La última vista se guarda en el navegador: cada test arranca sin ella.
  beforeEach(() => localStorage.removeItem('dashboard-filtros'))

  it('abre la pestaña, el período y la vendedora que trae el enlace', () => {
    renderDashboard(true, '/dashboard?pestana=ventas&dias=7&vendedora=2')

    expect(screen.getByRole('tab', { name: 'Ventas' })).toHaveAttribute('aria-selected', 'true')
    expect(requests.at(-1)).toEqual({ days: 7, scope: null, sellerId: 2 })
    expect(screen.getByLabelText('De quién son las métricas')).toHaveTextContent('Lucía Ramos')
    expect(screen.getByText(/Lo que separó Lucía Ramos/)).toBeInTheDocument()
  })

  it('lleva cada cambio de filtro a la dirección y lo recuerda al volver sin parámetros', async () => {
    const user = userEvent.setup()
    const { unmount } = renderDashboard(true)

    await user.click(screen.getByRole('tab', { name: 'Ventas' }))
    await user.click(screen.getByLabelText('Período'))
    await user.click(screen.getByRole('option', { name: 'Últimos 7 días' }))
    await user.click(screen.getByLabelText('De quién son las métricas'))
    await user.click(screen.getByRole('option', { name: 'Marco Díaz' }))
    expect(screen.getByTestId('query')).toHaveTextContent('?pestana=ventas&dias=7&vendedora=3')
    unmount()

    // Entrar desde el menú (sin parámetros) vuelve a la última vista.
    renderDashboard(true)
    expect(screen.getByTestId('query')).toHaveTextContent('vendedora=3')
    expect(requests.at(-1)).toEqual({ days: 7, scope: null, sellerId: 3 })
  })

  it('cada sección copia su propio enlace, con la vista actual y su nombre al final', async () => {
    const user = userEvent.setup()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    // En la app el router y la barra de direcciones coinciden; acá hay que
    // fijar la dirección de la ventana, que es la que se copia.
    window.history.replaceState({}, '', '/dashboard?pestana=ventas&dias=7&vendedora=2')
    renderDashboard(true, '/dashboard?pestana=ventas&dias=7&vendedora=2')

    // Ya no hay un "Copiar enlace" general: la barra de direcciones cumple esa función.
    expect(screen.queryByRole('button', { name: 'Copiar enlace' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Copiar enlace a la sección Por tratamiento' }))
    expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/dashboard\?pestana=ventas&dias=7&vendedora=2#por-tratamiento$/))
  })

  it('al abrir el enlace de una sección baja hasta ella', () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderDashboard(true, '/dashboard?pestana=ventas&dias=30&alcance=equipo#por-tratamiento')

    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('seccion-por-tratamiento'))
  })

  it('al vendedor no le ofrece mirar a otras personas', async () => {
    const user = userEvent.setup()
    renderDashboard(false)
    await user.click(screen.getByLabelText('De quién son las métricas'))
    expect(screen.getByRole('option', { name: 'Todo el equipo' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Lucía Ramos' })).toBeNull()
  })

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

  it('resume las separaciones en la moneda del negocio y contra el período anterior', () => {
    renderDashboard(true)

    // La venta del negocio es la separación de cita: el monto es la suma de
    // adelantos, con la moneda del perfil y el cambio con flecha y signo.
    expect(screen.getByText(/S\/\s?250/)).toBeInTheDocument()
    expect(screen.getByText('▲ +50% vs. período anterior')).toBeInTheDocument()
    expect(screen.getAllByText('▲ +25% vs. período anterior')).toHaveLength(2)
    // Las variantes de escritura del tratamiento cuentan juntas.
    expect(screen.getByText('Tratamientos más separados')).toBeInTheDocument()
    expect(screen.getByText('Hifu12D')).toBeInTheDocument()
  })

  it('lleva de Resumen a la pestaña de ventas', async () => {
    const user = userEvent.setup()
    renderDashboard(true)

    await user.click(screen.getByRole('button', { name: 'Ver ventas' }))
    expect(screen.getByRole('tab', { name: 'Ventas' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Monto de separación')).toBeInTheDocument()
  })

  it('compara las separaciones con el período anterior y ya no muestra compras registradas', async () => {
    const user = userEvent.setup()
    renderDashboard(true)
    await user.click(screen.getByRole('tab', { name: 'Ventas' }))

    expect(screen.getByText('3 clientas')).toBeInTheDocument()
    expect(screen.getByText('2 de 3 separaciones')).toBeInTheDocument()
    for (const label of ['▲ +50%', '▲ +25%']) {
      expect(screen.getAllByText(label).length).toBeGreaterThan(0)
    }
    // "Registrar compra" se quitó: aunque el backend traiga compras, la
    // pestaña ya no las muestra.
    expect(screen.queryByRole('heading', { name: 'Compras registradas' })).toBeNull()
    expect(screen.queryByText('Monto vendido')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Compras registradas' })).toBeNull()
  })

  it('abre el chat de una separación ligada a un lead y lista sin enlace la que no lo está', async () => {
    const user = userEvent.setup()
    const { onOpenChat } = renderDashboard(true)
    await user.click(screen.getByRole('tab', { name: 'Ventas' }))

    await user.click(screen.getByRole('button', { name: /Ana Torres/ }))
    expect(onOpenChat).toHaveBeenCalledWith('lead-9')
    expect(screen.getByText('Sin Ficha')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sin Ficha/ })).toBeNull()
    expect(screen.getByText('Sin adelanto')).toBeInTheDocument()
  })

  it('desglosa las separaciones por tratamiento, en cantidad o en monto', async () => {
    const user = userEvent.setup()
    renderDashboard(true)
    await user.click(screen.getByRole('tab', { name: 'Ventas' }))

    expect(screen.getByRole('heading', { name: 'Por tratamiento' })).toBeInTheDocument()
    expect(screen.getByText('Hifu12D fue el más separado: 4, el 50% del período.')).toBeInTheDocument()
    const panel = screen.getByRole('heading', { name: 'Por tratamiento' }).closest('section')!
    await user.click(within(panel).getByRole('button', { name: 'Monto' }))
    expect(within(panel).getByText(/Hifu12D fue el más separado: S\/\s?400, el 67% del período\./)).toBeInTheDocument()
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

    await user.click(screen.getByLabelText('De quién son las métricas'))
    await user.click(screen.getByRole('option', { name: 'Todo el equipo' }))
    expect(requestedScopes.at(-1)).toBe('team')
  })
})
