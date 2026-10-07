
import type { JsonObject } from "../../shared/types";
import type { Message, MessageType } from '../whatsapp/types'

export interface InternalNoteMention {
  user_id: number
  user_name: string
}

export interface InternalNote {
  id: number
  lead_id: string
  author_user_id: number
  author_name: string
  content: string
  created_at: string
  updated_at: string
  is_edited: boolean
  mentions: InternalNoteMention[]
}

export type ScheduledMessageStatus = 'scheduled' | 'processing' | 'queued' | 'sent' | 'failed' | 'cancelled'

export interface ScheduledMessage {
  id: number
  lead_id: string
  text: string
  scheduled_at: string
  status: ScheduledMessageStatus
  created_by_user_id: number
  created_by_user_name: string
  queued_message_id: number | null
  error: string | null
  created_at: string
}

export interface CustomerServiceWindow {
  is_open: boolean
  last_customer_message_at: string | null
  expires_at: string | null
  seconds_remaining: number
}

export interface MessagePage {
  items: Message[]
  has_more: boolean
}

export type MessageCursor = { cursorTs: string; cursorId: number } | null

/** Mensaje al que se está respondiendo. El backend solo necesita el id; el
 * resto viaja para poder pintar la cita antes de que conteste. */
export interface ReplyTarget {
  id: number
  sender: string
  content: string | null
}

export interface OptimisticMessageDraft {
  content: string | null
  media_url?: string | null
  reply_to?: ReplyTarget | null
  message_type?: MessageType | null
  message_subtype?: string | null
  payload?: JsonObject | null
  /** Cuerpo de Meta que se va a mandar, para pintar la burbuja igual que
   * cuando el backend la confirme. */
  provider_payload?: JsonObject | null
}

export interface OptimisticContext {
  optimisticIds: number[]
}

export interface TextPayload {
  text: string
  replyTo?: ReplyTarget | null
}

export interface AudioPayload {
  contentType: string
  dataBase64: string
  replyTo?: ReplyTarget | null
}

export interface MediaPayload {
  contentType: string
  dataBase64: string
  filename?: string
  /** Epígrafe opcional (el texto debajo de la imagen/video), como en WhatsApp. */
  caption?: string
  replyTo?: ReplyTarget | null
  /** Comparten este id las fotos/videos elegidos juntos en el mismo picker
   * (ver ChatComposer): agrupa el hilo en grilla sin depender de adivinar por
   * tiempo — la Cloud API de WhatsApp no tiene álbum saliente, así que esto
   * es puramente para la vista del propio CRM. */
  albumId?: string
}

export interface SendTemplatePayload {
  templateId: number
  text: string
  parameters?: string[]
  optimisticMessages: OptimisticMessageDraft[]
}

export interface ReactionPayload {
  messageId: number
  emoji: string
}

export interface ForwardPayload {
  messageIds: number[]
  targetChatIds: string[]
}

export interface ForwardResult {
  forwarded_chats: number
  forwarded_messages: number
  skipped_messages: number
}

export interface StickerPayload {
  assetId: number
  /** URL del asset, para pintar la burbuja optimista antes de la respuesta. */
  mediaUrl: string
}

export interface LocationPayload {
  latitude: number
  longitude: number
  replyTo?: ReplyTarget | null
}

export interface ContactShareInput {
  fullName: string
  phoneNumber: string
}

export interface ContactsPayload {
  contacts: ContactShareInput[]
  replyTo?: ReplyTarget | null
}

export interface InteractivePayload {
  interactive: JsonObject
  replyTo?: ReplyTarget | null
}

export interface NoteInput {
  content: string
  mentionedUserIds: number[]
}
