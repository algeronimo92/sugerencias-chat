import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DashboardMetrics } from '../types'
import { ServiceBreakdownPanel } from './ServiceBreakdownPanel'

// Seis tratamientos de una clínica, así el sexto cae en "Otros". Los números son deterministas para que la historia no cambie.
const SERVICES = [
  { id: 1, name: 'HIFU', price: 650, perDay: [1, 0, 2, 1, 0, 1, 2] },
  { id: 2, name: 'Hollywood Peel', price: 280, perDay: [2, 1, 1, 0, 2, 1, 1] },
  { id: 3, name: 'Depilación láser', price: 220, perDay: [1, 1, 0, 2, 1, 0, 1] },
  { id: 4, name: 'Toxina botulínica', price: 520, perDay: [0, 1, 0, 0, 1, 0, 1] },
  { id: 5, name: 'Hydrafacial', price: 190, perDay: [0, 0, 1, 0, 0, 1, 0] },
  { id: 6, name: 'Peeling químico', price: 150, perDay: [0, 0, 0, 1, 0, 0, 0] },
]

// Separaciones de ejemplo: cuántas citas y cuánto de adelanto por día, con
// un precio de separación distinto por tratamiento.
function metrics(days: number): DashboardMetrics {
  const start = new Date(2026, 9, 11)
  const dates = Array.from({ length: days }, (_, i) => {
    const day = new Date(start)
    day.setDate(start.getDate() + i)
    return day.toISOString().slice(0, 10)
  })
  const daily = dates.flatMap((date, i) =>
    SERVICES.map((service) => {
      const count = service.perDay[(i + service.id) % 7]
      return { date, key: service.name.toLowerCase().replace(/\s+/g, ''), name: service.name, count, amount: count * service.price / 4 }
    }).filter((row) => row.count > 0),
  )
  return {
    currency: 'PEN',
    appointments: { trend: dates.map((date) => ({ date, value: 0 })), by_treatment_daily: daily },
  } as unknown as DashboardMetrics
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

export const UltimosTreintaDias: Story = { args: { data: metrics(30), days: 30 } }
export const UltimaSemana: Story = { args: { data: metrics(7), days: 7 } }
