import type { LeadStage } from "../leads/types";
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

export interface AIUsage {
  enabled: boolean
  monthly_quota: number | null
  used_this_month: number
  remaining: number | null
}

export interface GenerateParams {
  chat_id: string
  phone: string | null
  // Ignora la sugerencia guardada y pide un juego nuevo ("Generá otras").
  force?: boolean
  // Indicación opcional del asesor ("dar precio", "no dar precio"…). El
  // backend la sanea y la pasa al prompt; si viene, siempre genera de nuevo.
  instruction?: string
}

export interface LeadAnalysisResult {
  changed?: boolean
  stage?: LeadStage | null
}

export interface TtsResult {
  contentType: string
  dataBase64: string
}
