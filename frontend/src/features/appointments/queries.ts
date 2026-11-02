import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../shared/queryClient'
import { fetchAppointments, createAppointment, syncAppointmentCalendar } from './api'
import { appointmentKeys } from './keys'

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
  })
}

export function useSyncAppointmentCalendar() {
  return useMutation({
    mutationFn: syncAppointmentCalendar,
    onSettled: () => queryClient.invalidateQueries({ queryKey: appointmentKeys.all }),
  })
}
