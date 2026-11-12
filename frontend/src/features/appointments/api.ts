import client from "../../shared/http/client";
import type { ApiResponse } from '../../shared/http/contract'
import type { AppointmentListItem, AppointmentResult, CalendarEventTemplate, CreateAppointmentInput, NoticeAudience, NoticeSettings, NoticeUpdate } from './types';

export async function fetchAppointments(): Promise<AppointmentListItem[]> {
  return (await client.get<ApiResponse<'/api/appointments', 'get'>>('/api/appointments')).data
}

export async function createAppointment(input: CreateAppointmentInput): Promise<AppointmentResult> {
  return (await client.post<ApiResponse<'/api/appointments', 'post'>>('/api/appointments', {
      nombre_completo: input.nombreCompleto,
      dni: input.dni,
      telefono: input.telefono,
      tratamiento: input.tratamiento,
      detalle: input.detalle,
      fecha: input.fecha,
      hora: input.hora,
      vendedor: input.vendedor,
      adelanto: input.adelanto,
      duration_minutes: input.durationMinutes,
      custom_fields: input.customFields,
      comprobante: input.comprobante && {
        content_type: input.comprobante.contentType,
        data_base64: input.comprobante.dataBase64,
        filename: input.comprobante.filename,
      },
      test_mode: input.testMode,
      lead_id: input.leadId ?? null,
      lead_updates: input.leadUpdates ?? null,
    })).data
}

export async function syncAppointmentCalendar(appointmentId: number): Promise<AppointmentListItem> {
  return (
      await client.post<ApiResponse<'/api/appointments/{appointment_id}/sync-calendar', 'post'>>(`/api/appointments/${appointmentId}/sync-calendar`)
    ).data
}

export async function fetchCalendarEventTemplate(): Promise<CalendarEventTemplate> {
  return (await client.get<ApiResponse<'/api/appointments/calendar-template', 'get'>>('/api/appointments/calendar-template')).data
}

export async function saveCalendarEventTemplate(values: { title: string; description: string }): Promise<CalendarEventTemplate> {
  return (
    await client.put<ApiResponse<'/api/appointments/calendar-template', 'put'>>('/api/appointments/calendar-template', {
      title_template: values.title,
      description_template: values.description,
    })
  ).data
}

/** Moneda del negocio (código ISO, p. ej. PEN), que vive en su perfil. El
 *  formulario la usa para mostrar el símbolo junto al adelanto. */
export async function fetchBusinessCurrency(): Promise<string | null> {
  return (await client.get<ApiResponse<'/api/ai/profile', 'get'>>('/api/ai/profile')).data.currency ?? null
}

export async function fetchNotice(audience: NoticeAudience): Promise<NoticeSettings> {
  return (
    await client.get<ApiResponse<'/api/appointments/notices/{audience}', 'get'>>(`/api/appointments/notices/${audience}`)
  ).data
}

export async function saveNotice(audience: NoticeAudience, values: NoticeUpdate): Promise<NoticeSettings> {
  return (
    await client.put<ApiResponse<'/api/appointments/notices/{audience}', 'put'>>(`/api/appointments/notices/${audience}`, values)
  ).data
}
