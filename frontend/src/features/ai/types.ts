import type { ApiSchemas, Delivered } from '../../shared/http/contract'
import type { LeadStage } from '../leads/types'
export interface AIProfile {
  business_name: string | null
  business_description: string | null
  location: string | null
  opening_hours: string | null
  currency: string | null
  tone: string | null
  always_rules: string | null
  never_rules: string | null
  updated_at?: string | null
}

export interface KnowledgeDocumentSummary {
  id: string
  title: string
  document_type: string | null
  characters: number
  chunk_count: number
  created_at: string
  updated_at: string
}

export interface KnowledgeDocument extends KnowledgeDocumentSummary {
  content: string
}

export type AIUsage = Delivered<ApiSchemas['AIUsage']>

export interface GenerateParams {
  chat_id: string
  phone: string | null
  // Ignora la sugerencia guardada y pide un juego nuevo ("Generá otras").
  force?: boolean
  // Indicación opcional del asesor ("dar precio", "no dar precio"…). El
  // backend la sanea y la pasa al prompt; si viene, siempre genera de nuevo.
  instruction?: string
}

export type LeadAnalysisResult = Delivered<ApiSchemas['LeadAnalysisResult']>

export interface TtsResult {
  contentType: string
  dataBase64: string
}

export interface Sugerencia {
  tactica: string
  canal: string
  texto: string | null
  adjuntos: string[]
  motivo_adjuntos: string
  porque: string
}

export interface SuggestionResponse {
  estado: LeadStage | null
  tipo_objecion: string | null
  senal_compra: boolean
  alerta: string | null
  confianza: string
  analisis: string
  sugerencias: Sugerencia[]
}

/** Estado de la sugerencia guardada de un lead — lectura barata que nunca
 * dispara la generación. `stale`: el cliente escribió después de generarse. */
export interface SuggestionStatus {
  suggestion: SuggestionResponse | null
  generated_at: string | null
  stale: boolean
}
