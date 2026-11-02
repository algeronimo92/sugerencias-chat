/**
 * Un mensaje saliente, del tipo que sea. Todos se envían por el mismo comando
 * (useOutboundMessage): cola ordenada por chat, burbuja optimista,
 * reconciliación con lo que confirma el servidor y refetch al final. Lo único
 * que cambia por tipo es el pedido HTTP y cómo se ve la burbuja mientras viaja.
 */

import type { MessageType } from '../../whatsapp/types'
import type {
  AudioPayload,
  ContactsPayload,
  InteractivePayload,
  LocationPayload,
  MediaPayload,
  OptimisticMessageDraft,
  SendTemplatePayload,
  StickerPayload,
  TextPayload,
} from '../types'

export type OutboundMessage =
  | ({ kind: 'text' } & TextPayload)
  | ({ kind: 'audio' } & AudioPayload)
  | ({ kind: 'media' } & MediaPayload)
  | ({ kind: 'sticker' } & StickerPayload)
  | ({ kind: 'location' } & LocationPayload)
  | ({ kind: 'contacts' } & ContactsPayload)
  | ({ kind: 'interactive' } & InteractivePayload)
  | ({ kind: 'template' } & SendTemplatePayload)

export type OutboundKind = OutboundMessage['kind']

/** El mensaje de un tipo concreto. */
export type OutboundOf<K extends OutboundKind> = Extract<OutboundMessage, { kind: K }>

function dataUrl(contentType: string, dataBase64: string): string {
  return `data:${contentType};base64,${dataBase64}`
}

export function mediaMessageType(contentType: string): MessageType {
  if (contentType.startsWith('image/')) return 'image'
  if (contentType.startsWith('video/')) return 'video'
  if (contentType.startsWith('audio/')) return 'audio'
  return 'document'
}

const DRAFTS: { [K in OutboundKind]: (message: OutboundOf<K>) => OptimisticMessageDraft[] } = {
  text: ({ text, replyTo }) => [{ content: text, reply_to: replyTo }],
  audio: ({ contentType, dataBase64, replyTo }) => [{
    content: null,
    message_type: 'audio',
    media_url: dataUrl(contentType, dataBase64),
    reply_to: replyTo,
  }],
  media: ({ contentType, dataBase64, filename, caption, replyTo, albumId }) => {
    const messageType = mediaMessageType(contentType)
    // Repite lo que arma media_message_fields en el backend: si el mensaje
    // real trae album_id en el payload, el optimista también, para que la
    // grilla no "salte" al confirmarse el envío.
    const payload: { filename?: string; album_id?: string } =
      messageType === 'document' ? { filename: filename ?? 'Archivo' } : {}
    if (albumId) payload.album_id = albumId
    return [{
      content: caption || null,
      message_type: messageType,
      payload: Object.keys(payload).length ? payload : null,
      media_url: dataUrl(contentType, dataBase64),
      reply_to: replyTo,
    }]
  },
  sticker: ({ mediaUrl }) => [{ content: null, message_type: 'sticker', media_url: mediaUrl }],
  // Misma forma que el cuerpo de Meta que devolverá el backend.
  location: ({ latitude, longitude, replyTo }) => [{
    content: null,
    message_type: 'location',
    provider_payload: { location: { latitude, longitude } },
    reply_to: replyTo,
  }],
  contacts: ({ contacts, replyTo }) => [{
    content: null,
    message_type: 'contacts',
    provider_payload: {
      contacts: contacts.map(contact => ({
        name: { formatted_name: contact.fullName },
        phones: [{ phone: contact.phoneNumber }],
      })),
    },
    reply_to: replyTo,
  }],
  interactive: ({ interactive, replyTo }) => {
    const body = interactive.body
    const text = body && typeof body === 'object' && !Array.isArray(body) && typeof body.text === 'string' ? body.text : null
    return [{
      content: text,
      message_type: 'interactive',
      message_subtype: typeof interactive.type === 'string' ? interactive.type : null,
      provider_payload: { interactive },
      reply_to: replyTo,
    }]
  },
  // Una plantilla puede ser varios mensajes (texto y adjuntos): el diálogo
  // ya sabe cómo se van a ver.
  template: ({ optimisticMessages }) => optimisticMessages,
}

/** Las burbujas que se muestran mientras el mensaje viaja. */
export function outboundDrafts(message: OutboundMessage): OptimisticMessageDraft[] {
  return (DRAFTS[message.kind] as (message: OutboundMessage) => OptimisticMessageDraft[])(message)
}
