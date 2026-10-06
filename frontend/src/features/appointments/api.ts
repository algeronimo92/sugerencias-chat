import client from "../../shared/http/client";
import type { ApiResponse } from '../../shared/http/contract'
import type { AppointmentListItem, AppointmentResult, CreateAppointmentInput } from './types';

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
    })).data
}

export async function syncAppointmentCalendar(appointmentId: number): Promise<AppointmentListItem> {
  return (
      await client.post<ApiResponse<'/api/appointments/{appointment_id}/sync-calendar', 'post'>>(`/api/appointments/${appointmentId}/sync-calendar`)
    ).data
}
