import client from "../../shared/http/client";
import type { AppointmentListItem, AppointmentResult, CreateAppointmentInput } from './types';

export async function fetchAppointments() {
  return (await client.get<AppointmentListItem[]>('/api/appointments')).data
}

export async function createAppointment(input: CreateAppointmentInput) {
  return (await client.post<AppointmentResult>('/api/appointments', {
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

export async function syncAppointmentCalendar(appointmentId: number) {
  return (
      await client.post<AppointmentListItem>(`/api/appointments/${appointmentId}/sync-calendar`)
    ).data
}
