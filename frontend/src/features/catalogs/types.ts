export interface Tag {
  id: number
  name: string
  color: string
  is_active?: boolean
  created_by_user_id?: number | null
  created_by_name?: string | null
  created_at?: string | null
}

export interface LeadService {
  id: number
  name: string
  is_active?: boolean
  /** Catálogo que consulta el asistente IA; la moneda es la del perfil del negocio. */
  description?: string | null
  /** Decimal serializado como texto ("150.00"). */
  price?: string | null
  price_notes?: string | null
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
