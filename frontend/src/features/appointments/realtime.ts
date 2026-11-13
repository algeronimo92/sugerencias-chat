import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { appointmentKeys } from './keys'

/** Los avisos de cita solo ofrecen plantillas aprobadas: cuando Meta aprueba
 *  o rechaza una, la lista de Integraciones se refresca sin recargar. Las
 *  copias de la cuenta propia del número de avisos llegan aparte. */
export function createAppointmentsRealtime(): RealtimeModule {
  return {
    handlers: {
      templates_updated: (_event, { queryClient }) => invalidate(queryClient, appointmentKeys.notices),
      notice_sender_updated: (_event, { queryClient }) => invalidate(queryClient, appointmentKeys.noticeSender),
    },
    resync: [appointmentKeys.notices, appointmentKeys.noticeSender],
  }
}
