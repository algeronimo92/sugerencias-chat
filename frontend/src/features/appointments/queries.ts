import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../shared/queryClient'
import { fetchAppointments, createAppointment, fetchCalendarEventTemplate, saveCalendarEventTemplate, syncAppointmentCalendar } from './api'
import { appointmentKeys } from './keys'
import { leadKeys } from '../leads/public/keys'

export type { AppointmentAttachmentInput } from './types'

export type { CreateAppointmentInput } from './types'

export type { AppointmentResult } from './types'

export type { AppointmentListItem } from './types'

export function useAppointments() {
  return useQuery({
    queryKey: appointmentKeys.all,
    queryFn: fetchAppointments,
  })
}

export function useCreateAppointment() {
  return useMutation({
    mutationFn: createAppointment,
    // También se invalida en error: el backend registra el intento en el
    // historial aunque n8n lo haya rechazado, para poder revisar fallos.
    onSettled: () => queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
    // Agendada desde la ficha: el lead cambió (próxima cita, etapa, actividad
    // y lo que el vendedor corrigió). El tiempo real también avisa, pero el
    // que agendó no debería esperar a ese aviso para ver su propio cambio.
    onSuccess: (_result, input) => {
      if (!input.leadId) return
      void queryClient.invalidateQueries({ queryKey: leadKeys.detail(input.leadId) })
      void queryClient.invalidateQueries({ queryKey: leadKeys.activity(input.leadId) })
      void queryClient.invalidateQueries({ queryKey: leadKeys.customFieldValues(input.leadId) })
      void queryClient.invalidateQueries({ queryKey: leadKeys.lists })
    },
  })
}

export function useSyncAppointmentCalendar() {
  return useMutation({
    mutationFn: syncAppointmentCalendar,
    onSettled: () => queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
  })
}

export function useCalendarEventTemplate() {
  return useQuery({
    queryKey: appointmentKeys.calendarTemplate,
    queryFn: fetchCalendarEventTemplate,
  })
}

export function useSaveCalendarEventTemplate() {
  return useMutation({
    mutationFn: saveCalendarEventTemplate,
    onSuccess: (template) => queryClient.setQueryData(appointmentKeys.calendarTemplate, template),
  })
}
