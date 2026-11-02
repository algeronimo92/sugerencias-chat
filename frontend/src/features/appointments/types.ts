import type { ApiSchemas, Delivered } from '../../shared/http/contract'
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

/** Resultado de registrar una cita; trae además lo que devolvió el workflow
 * de n8n (por ejemplo `citaDuplicada`). */
export type AppointmentResult = Delivered<ApiSchemas['AppointmentCreated']>

export interface AppointmentListItem {
  id: number
  created_by_user_id: number
  created_by_name: string
  /** Lead al que quedó vinculada la cita, resuelto por teléfono al registrarla.
   *  null cuando ese número no identificó a un único lead. */
  lead_id: string | null
  /** Vendedor asignado a ese lead, si el lead está vinculado y tiene dueño. */
  lead_owner_name: string | null
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
