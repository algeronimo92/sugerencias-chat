export interface Chat {
  chat_id: string
  phone: string | null
  name: string | null
  servicio_interes: string | null
  vendedor: string | null
  origen: string | null
  notas: string | null
  last_message: string | null
  timestamp: string | null
}

export interface LeadInput {
  phone: string
  name: string
  servicio_interes?: string | null
  vendedor?: string | null
  origen?: string | null
  notas?: string | null
}

export interface LeadUpdateInput {
  phone?: string | null
  name?: string | null
  servicio_interes?: string | null
  vendedor?: string | null
  origen?: string | null
  notas?: string | null
}

export interface Message {
  id: number
  sender: string
  content: string | null
  sent_at: string | null
  media_url: string | null
}

export interface Sugerencia {
  tactica: string
  canal: string
  texto?: string
  adjuntos: string[]
  motivo_adjuntos: string
  porque: string
}

export interface SuggestionResponse {
  estado: string
  tipo_objecion: string | null
  confianza: string
  analisis: string
  sugerencias: Sugerencia[]
}
