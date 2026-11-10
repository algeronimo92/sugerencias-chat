import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DashboardHours } from '../types'
import { HoursHeatmap } from './HoursHeatmap'

// Una clínica que pauta de noche: mucho volumen de 18 a 22 h y mejor respuesta
// a media mañana. Números deterministas para que la historia no cambie.
const VOLUME = [1, 0, 0, 2, 9, 18, 22, 17, 20, 30, 36, 14]
const RATE = [0.15, 0.1, 0.1, 0.25, 0.52, 0.6, 0.5, 0.55, 0.48, 0.4, 0.34, 0.22]
const DAY_WEIGHT = [1, 0.95, 0.9, 1, 0.85, 0.7, 0.5]

const HOURS: DashboardHours = {
  slot_hours: 2,
  engagement_window_hours: 24,
  weekday_occurrences: [5, 5, 4, 4, 4, 4, 4],
  cells: DAY_WEIGHT.flatMap((weight, weekday) =>
    VOLUME.map((volume, slot) => {
      const conversations = Math.round(volume * weight)
      return {
        weekday,
        slot,
        conversations,
        settled: conversations,
        engaged: Math.round(conversations * RATE[slot]),
        flows_manual: slot >= 4 && slot <= 9 ? Math.round(conversations * 0.6) : 0,
        flows_automatic: conversations,
      }
    }),
  ),
}

const meta = {
  title: 'Dashboard/HoursHeatmap',
  component: HoursHeatmap,
  args: {
    hours: HOURS,
    days: 30,
    label: 'Horas de más movimiento',
    readings: [
      { key: 'conversations', label: 'Cuántas llegan', hint: 'Conversaciones nuevas, en promedio por día de la semana.' },
      { key: 'engaged', label: 'Siguieron conversando', hint: '% que volvió a escribir después de nuestra primera respuesta, dentro de las 24 h.' },
    ],
  },
  decorators: [(Story) => <div className="max-w-3xl rounded-xl border border-wa-border bg-white p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark"><Story /></div>],
} satisfies Meta<typeof HoursHeatmap>

export default meta
type Story = StoryObj<typeof meta>

export const Conversaciones: Story = {}

export const Flujos: Story = {
  args: {
    label: 'A qué hora salen los flujos',
    readings: [
      { key: 'flows_manual', label: 'A mano', hint: 'Flujos iniciados desde un chat.' },
      { key: 'flows_automatic', label: 'Automáticos', hint: 'Flujos que arrancó un disparador.' },
    ],
  },
}

export const PeriodoCorto: Story = { args: { days: 7 } }
