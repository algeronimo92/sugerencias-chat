import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../shared/queryClient'
import { copyNoticeTemplates, fetchAppointments, createAppointment, fetchCalendarEventTemplate, fetchNotice, fetchNoticeSender, linkNoticeSender, saveCalendarEventTemplate, saveNotice, saveNoticeSender, syncAppointmentCalendar } from './api'
import { appointmentKeys } from './keys'
import type { NoticeAudience, NoticeUpdate } from './types'
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

export function useNotice(audience: NoticeAudience) {
  return useQuery({
    queryKey: appointmentKeys.notice(audience),
    queryFn: () => fetchNotice(audience),
  })
}

export function useSaveNotice(audience: NoticeAudience) {
  return useMutation({
    mutationFn: (values: NoticeUpdate) => saveNotice(audience, values),
    onSuccess: (settings) => queryClient.setQueryData(appointmentKeys.notice(audience), settings),
  })
}

export function useNoticeSender() {
  return useQuery({
    queryKey: appointmentKeys.noticeSender,
    queryFn: fetchNoticeSender,
    // Sin WhatsApp conectado Meta no responde: reintentar no lo arregla.
    retry: false,
  })
}

export function useSaveNoticeSender() {
  return useMutation({
    mutationFn: saveNoticeSender,
    onSuccess: (sender) => {
      queryClient.setQueryData(appointmentKeys.noticeSender, sender)
      // Con número de avisos el aviso al equipo admite plantillas con imagen.
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.notices })
    },
  })
}

export function useLinkNoticeSender() {
  return useMutation({
    mutationFn: linkNoticeSender,
    onSuccess: (sender) => {
      queryClient.setQueryData(appointmentKeys.noticeSender, sender)
      void queryClient.invalidateQueries({ queryKey: appointmentKeys.notices })
    },
  })
}

export function useCopyNoticeTemplates() {
  return useMutation({
    mutationFn: copyNoticeTemplates,
    onSuccess: (sender) => queryClient.setQueryData(appointmentKeys.noticeSender, sender),
  })
}
