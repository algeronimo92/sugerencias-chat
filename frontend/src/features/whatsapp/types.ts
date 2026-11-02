import type { ApiSchemas, Delivered } from '../../shared/http/contract'
import type { MetaInboundRootType, MetaOutboundRootType, MetaStatus as MetaStatusLiteral } from './domain/metaContract'


/** Estado interno de un envío en la cola propia (outbox). `discarded` es un
 * fallo que alguien revisó y decidió no reenviar: sigue sin haber llegado al
 * cliente, pero ya no ofrece reintento. */
export type OutboxStatus = ApiSchemas['MessageOutboxStatus']

/** Estado literal que informa Meta. Un valor nuevo llega con su nombre. */
export type MetaStatus = MetaStatusLiteral | (string & {})

/** `messages[].type` literal de Meta (ver backend/contracts/meta_messages.json).
 * Un tipo que el contrato todavía no conoce llega igual, con su nombre, y se
 * muestra con un renderer genérico en vez de perderse. */
export type MessageType = MetaInboundRootType | MetaOutboundRootType | (string & {})

/** Enriquecimiento generado con IA para un adjunto: descripción de imagen/video,
 * transcripción de audio, OCR de documento. Se muestra bajo demanda, no dentro
 * de la burbuja. */
export interface MessageAnalysis {
  summary: string
  kind?: 'descripcion' | 'transcripcion' | 'ocr'
  model?: string
  generated_at?: string
  version?: number
}

export interface MessageReaction {
  emoji: string
  /** true = la puso el vendedor desde la app (o un dispositivo vinculado);
   * false = la puso el cliente. */
  from_me: boolean
}

/** Un mensaje del hilo tal como lo entrega el backend (contrato `Message`). */
export type ContractMessage = Delivered<ApiSchemas['Message']>

export type MessageDirection = ApiSchemas['MessageDirection']

/**
 * Un mensaje del hilo. Sale del contrato (`ContractMessage`); `analysis` y
 * `reactions` los guarda el backend como JSON con la forma que valida su
 * dominio, y la frontera se la da (`toMessage`).
 *
 * `message_type` y `meta_status` quedan como texto: son los literales de Meta,
 * y uno que el contrato todavía no conoce se muestra igual con su nombre.
 */
export type Message = Omit<ContractMessage, 'analysis' | 'reactions'> & {
  analysis: MessageAnalysis | null
  reactions: MessageReaction[] | null
}
