import type { ApiSchemas, Delivered } from '../../shared/http/contract'

/** Una llamada de WhatsApp como la entrega el backend. Nunca trae la oferta de audio. */
export type Call = Delivered<ApiSchemas['CallItem']>
export type CallStatus = Call['status']
