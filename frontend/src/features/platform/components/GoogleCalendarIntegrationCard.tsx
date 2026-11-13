import { GoogleCalendarMark } from '../../../shared/ui/BrandMarks'
import type { ReactNode } from 'react'
import { IntegrationCard } from '../../../shared/ui/IntegrationCard'
import { useGoogleCalendarStatus } from '../hooks/useGoogleCalendar'
import { GoogleCalendarPanel } from './GoogleCalendarPanel'

/** Conectado, toda la configuración queda a la vista: calendario, zona
 *  horaria y plantilla del evento son lo que el admin viene a tocar. */
export function GoogleCalendarIntegrationCard({ eventEditor }: { eventEditor?: ReactNode }) {
  const { data: status, isError } = useGoogleCalendarStatus()
  const state = isError ? 'error' : status?.connected ? 'connected' : 'unconfigured'
  return (
    <IntegrationCard
      id="calendario"
      icon={GoogleCalendarMark}
      title="Google Calendar"
      state={state}
      stateLabel={status?.connected && status.account_email ? `Conectado · ${status.account_email}` : undefined}
    >
      <GoogleCalendarPanel eventEditor={eventEditor} />
    </IntegrationCard>
  )
}
