import { useMutation } from '@tanstack/react-query'
import client from '../api/client'

export interface AppointmentAttachmentInput {
  contentType: string
  dataBase64: string
  filename: string
}

export interface CreateAppointmentInput {
  nombreCompleto: string
  dni: string
  telefono: string
  tratamiento: string
  detalle: string
  fecha: string
  hora: string
  vendedor: string
  adelanto: number
  comprobante: AppointmentAttachmentInput | null
  testMode: boolean
}

export interface AppointmentResult {
  success?: boolean
  status?: string
  message?: string
  eventLink?: string
  citaDuplicada?: boolean
  [key: string]: unknown
}

export function useCreateAppointment() {
  return useMutation({
    mutationFn: async (input: CreateAppointmentInput) => (await client.post<AppointmentResult>('/api/appointments', {
      nombre_completo: input.nombreCompleto,
      dni: input.dni,
      telefono: input.telefono,
      tratamiento: input.tratamiento,
      detalle: input.detalle,
      fecha: input.fecha,
      hora: input.hora,
      vendedor: input.vendedor,
      adelanto: input.adelanto,
      comprobante: input.comprobante && {
        content_type: input.comprobante.contentType,
        data_base64: input.comprobante.dataBase64,
        filename: input.comprobante.filename,
      },
      test_mode: input.testMode,
    })).data,
  })
}
