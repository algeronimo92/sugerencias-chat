import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import type { AppointmentStatus } from '../domain/appointments'
import { queryClient } from '../queryClient'

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

export interface AppointmentListItem {
  id: number
  created_by_user_id: number
  created_by_name: string
  nombre_completo: string
  dni: string
  telefono: string
  tratamiento: string
  detalle: string
  fecha: string
  hora: string
  vendedor: string
  adelanto: number
  comprobante_filename: string | null
  test_mode: boolean
  status: AppointmentStatus
  n8n_status: string | null
  message: string | null
  event_link: string | null
  created_at: string
}

export function useAppointments() {
  return useQuery({
    queryKey: ['appointments'],
    queryFn: async () => (await client.get<AppointmentListItem[]>('/api/appointments')).data,
  })
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
    // También se invalida en error: el backend registra el intento en el
    // historial aunque n8n lo haya rechazado, para poder revisar fallos.
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['appointments'] }),
  })
}
