import type { Meta, StoryObj } from '@storybook/react-vite'
import type { DashboardHours, DashboardPersonHourCell } from '../types'
import { TeamHoursPanel } from './TeamHoursPanel'

// Un equipo que atiende casi todo por WhatsApp: quien abre y escribe algo en
// el CRM, quien casi no lo usa, un admin que entra de noche y alguien que no
// escribió nada ahí. Números deterministas para que la historia no cambie.
function shift(weeks: number, slots: [number, number], volume: number, flows: number, off: number[]): DashboardPersonHourCell[] {
  const cells: DashboardPersonHourCell[] = []
  for (let weekday = 0; weekday < 7; weekday++) {
    if (off.includes(weekday)) continue
    for (let slot = slots[0]; slot <= slots[1]; slot++) {
      const wave = 1 + ((weekday * 7 + slot * 3) % 5) / 4
      cells.push({
        weekday,
        slot,
        messages: Math.round(volume * wave * weeks),
        flows_manual: slot % 2 ? Math.round(flows * wave * weeks) : 0,
      })
    }
  }
  return cells
}

function hours(days: number): DashboardHours {
  const weeks = days / 7
  const occurrences = days === 7 ? [1, 1, 1, 1, 1, 1, 1] : [5, 5, 4, 4, 4, 4, 4]
  const people = [
    { user_id: 1, name: 'Grecia Geronimo', cells: shift(weeks, [4, 9], 1.6, 2, [6]) },
    { user_id: 2, name: 'Antonella Geronimo', cells: shift(weeks, [5, 7], 0.5, 0.5, [2, 5, 6]) },
    { user_id: 3, name: 'Admin', cells: shift(weeks, [10, 11], 0.6, 0, [0, 1, 2, 5, 6]) },
    { user_id: 4, name: 'Zoe Paredes', cells: [] },
  ]
  const peak = (field: 'messages' | 'flows_manual') =>
    Math.max(...people.flatMap(person => person.cells.map(cell => cell[field] / occurrences[cell.weekday])))
  // Lo de WhatsApp es del negocio entero y unas veinte veces lo del CRM.
  const cells = shift(weeks, [4, 10], 38, 0, []).map(cell => ({
    weekday: cell.weekday, slot: cell.slot, phone_messages: cell.messages,
    conversations: 0, settled: 0, engaged: 0, flows_manual: 0, flows_automatic: 0, messages: 0,
  }))
  return {
    slot_hours: 2,
    engagement_window_hours: 24,
    weekday_occurrences: occurrences,
    start_date: days === 7 ? '2026-11-05' : '2026-10-13',
    person_peaks: { messages: peak('messages'), flows_manual: peak('flows_manual') },
    people,
    cells,
  }
}

const meta = {
  title: 'Dashboard/TeamHoursPanel',
  component: TeamHoursPanel,
  decorators: [Story => <div className="w-[min(72rem,90vw)]"><Story /></div>],
} satisfies Meta<typeof TeamHoursPanel>

export default meta
type Story = StoryObj<typeof meta>

/** Una semana: cada fila es un día concreto. */
export const UltimaSemana: Story = { args: { hours: hours(7) } }

/** Un mes: de lunes a domingo, en promedio. */
export const UltimoMes: Story = { args: { hours: hours(30) } }
