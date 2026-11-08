export interface Tag {
  id: number
  name: string
  color: string
  is_active?: boolean
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
}

/**
 * Presentación vendible de un servicio (1 sesión, pack x3...). El cliente llega
 * con un problema; el vendedor cierra con el paquete que lo resuelve.
 */
export interface ServicePackage {
  id: number
  service_id: number
  name: string
  sessions: number
  /** Precio total del paquete, decimal serializado como texto ("400.00"). */
  price: string
  notes?: string | null
  position: number
  is_active: boolean
  /** Con valor, lo administra el ERP del negocio: en el CRM es solo lectura. */
  external_id?: string | null
}

export interface LeadService {
  id: number
  name: string
  is_active?: boolean
  packages?: ServicePackage[]
  /** Con valor, nombre, paquetes y alta/baja los administra el ERP del negocio. */
  external_id?: string | null
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
}

export type CustomFieldEntity = 'lead' | 'appointment'

export type CustomFieldType = 'text' | 'textarea' | 'number' | 'date' | 'datetime' | 'boolean' | 'select'

export interface CustomFieldDefinition {
  id: number
  entity_type: CustomFieldEntity
  key: string
  label: string
  field_type: CustomFieldType
  required: boolean
  options: string[]
  position: number
  is_active: boolean
}

export interface ErpSyncSummary {
  services_total: number
  services_created: number
  services_updated: number
  services_deactivated: number
  packages_created: number
  packages_updated: number
  packages_deactivated: number
  conflicts: string[]
}

/** Estado de la sincronización del catálogo con el ERP del negocio. */
export interface ErpSyncStatus {
  configured: boolean
  url?: string | null
  synced_at?: string | null
  last_error?: string | null
  last_summary?: ErpSyncSummary | null
}

export interface ErpSamplePackage { label: string; sessions: number; price: string }
export interface ErpSampleService { name: string; packages: ErpSamplePackage[] }

/** Resultado de "Probar conexión" con el ERP: no guarda ni sincroniza nada. */
export interface ErpTestResult {
  ok: boolean
  url?: string | null
  error?: string | null
  services_total: number
  packages_total: number
  services_without_packages: string[]
  sample: ErpSampleService[]
}

/** Qué nombra a un servicio (leads, ventas, plantillas, automatizaciones,
 *  documentos): cuántos y los primeros, para ir a revisarlos. */
export interface ServiceUsageGroup {
  kind: string
  label: string
  count: number
  items?: { id: string; name: string }[]
}
