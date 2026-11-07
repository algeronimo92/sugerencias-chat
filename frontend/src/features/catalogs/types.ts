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
}

export interface LeadService {
  id: number
  name: string
  is_active?: boolean
  /** Catálogo que consulta el asistente IA; la moneda es la del perfil del negocio. */
  description?: string | null
  /** Condiciones generales (promociones, vigencia). El precio vive en los paquetes. */
  price_notes?: string | null
  packages?: ServicePackage[]
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
