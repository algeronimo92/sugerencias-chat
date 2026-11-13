import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { RealtimeContext } from '../../realtime/bus'
import { appointmentKeys } from './keys'
import { createAppointmentsRealtime } from './realtime'

describe('tiempo real de los avisos de cita', () => {
  it('un cambio en las plantillas del número de avisos vuelve a leer su tarjeta', () => {
    const queryClient = new QueryClient()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')
    const { handlers, resync } = createAppointmentsRealtime()

    handlers.notice_sender_updated?.({ type: 'notice_sender_updated' }, { queryClient } as unknown as RealtimeContext)

    expect(invalidate).toHaveBeenCalledWith({ queryKey: appointmentKeys.noticeSender })
    // Con el socket caído el aviso se pierde: al reconectar se relee.
    expect(resync).toContainEqual(appointmentKeys.noticeSender)
  })
})
