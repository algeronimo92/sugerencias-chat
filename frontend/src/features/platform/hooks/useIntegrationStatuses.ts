import { useErpSyncStatus } from '../../catalogs/public/useErpSync'
import { useGoogleCalendarStatus } from './useGoogleCalendar'
import { useSettings } from './useSettings'
import { useWhatsappStatus } from './useWhatsapp'

/** Cuántas integraciones están conectadas, para la línea de resumen de la página. */
export function useIntegrationStatuses() {
  const whatsapp = useWhatsappStatus()
  const calendar = useGoogleCalendarStatus()
  const erp = useErpSyncStatus()
  const settings = useSettings(true)
  const loading = whatsapp.isLoading || calendar.isLoading || erp.isLoading || settings.isLoading
  const connected = {
    whatsapp: whatsapp.data?.state === 'open',
    calendar: Boolean(calendar.data?.connected),
    erp: Boolean(erp.data?.configured),
    voice: Boolean(settings.data?.some(item => item.key === 'elevenlabs_api_key' && item.configured)),
  }
  const count = Object.values(connected).filter(Boolean).length
  return { loading, connected, count, total: 4 }
}
