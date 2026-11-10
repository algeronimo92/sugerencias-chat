import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DashboardSales } from '../types'
import { ServiceBreakdownPanel } from './ServiceBreakdownPanel'

// Ventas de ejemplo de una clínica: seis tratamientos, así el sexto cae en
// "Otros". Los números son deterministas para que la historia no cambie.
const SERVICES = [
  { id: 1, name: 'HIFU', price: 650, perDay: [1, 0, 2, 1, 0, 1, 2] },
  { id: 2, name: 'Hollywood Peel', price: 280, perDay: [2, 1, 1, 0, 2, 1, 1] },
  { id: 3, name: 'Depilación láser', price: 220, perDay: [1, 1, 0, 2, 1, 0, 1] },
  { id: 4, name: 'Toxina botulínica', price: 520, perDay: [0, 1, 0, 0, 1, 0, 1] },
  { id: 5, name: 'Hydrafacial', price: 190, perDay: [0, 0, 1, 0, 0, 1, 0] },
  { id: 6, name: 'Peeling químico', price: 150, perDay: [0, 0, 0, 1, 0, 0, 0] },
]

function sales(days: number): DashboardSales {
  const start = new Date(2026, 9, 11)
  const dates = Array.from({ length: days }, (_, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    return day.toISOString().slice(0, 10)
  })
  const daily = dates.flatMap((date, i) =>
    SERVICES.map((service) => {
      const count = service.perDay[(i + service.id) % 7]
      return { date, service_id: service.id, name: service.name, count, revenue: count * service.price }
    }).filter((row) => row.count > 0),
  )
  const byService = SERVICES.map((service) => {
    const rows = daily.filter((row) => row.service_id === service.id)
    return {
      service_id: service.id,
      name: service.name,
      count: rows.reduce((sum, row) => sum + row.count, 0),
      revenue: rows.reduce((sum, row) => sum + row.revenue, 0),
    }
  }).sort((a, b) => b.revenue - a.revenue)
  return {
    currency: 'PEN',
    totals: { count: 0, revenue: 0, avg_ticket: null, sessions: 0, discount: 0, discount_rate: null, buyers: 0 },
    previous: null,
    trend: dates.map((date) => ({ date, count: 0, revenue: 0 })),
    previous_trend: [],
    by_package: [],
    by_service: byService,
    by_service_daily: daily,
    by_seller: [],
    recent: [],
  }
}

const meta = {
  title: 'Dashboard/Ventas por tratamiento',
  component: ServiceBreakdownPanel,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[960px] max-w-full rounded-xl border border-wa-border bg-white p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ServiceBreakdownPanel>

export default meta
type Story = StoryObj<typeof meta>

export const UltimosTreintaDias: Story = { args: { sales: sales(30), days: 30 } }
export const UltimaSemana: Story = { args: { sales: sales(7), days: 7 } }
export const SinVentas: Story = { args: { sales: { ...sales(30), by_service: [], by_service_daily: [] }, days: 30 } }
