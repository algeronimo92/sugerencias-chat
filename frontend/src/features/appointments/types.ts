import type { AppointmentStatus } from "./constants";

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
  durationMinutes: number
  customFields: Record<string, unknown>
  comprobante: AppointmentAttachmentInput | null
  testMode: boolean
}

export interface AppointmentResult {
  success?: boolean
  status?: string
  message?: string
  eventLink?: string
  calendarSyncStatus?: 'not_configured' | 'pending' | 'synced' | 'error' | 'skipped'
  integrationErrors?: string[]
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
  duration_minutes: number
  custom_fields: Record<string, unknown>
  comprobante_filename: string | null
  test_mode: boolean
  status: AppointmentStatus
  n8n_status: string | null
  message: string | null
  event_link: string | null
  calendar_event_id: string | null
  calendar_sync_status: 'not_configured' | 'pending' | 'synced' | 'error' | 'skipped'
  calendar_sync_error: string | null
  created_at: string
}
