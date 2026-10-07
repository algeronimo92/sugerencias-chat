const requestTails = new Map<string, Promise<void>>()
import client from "../../shared/http/client";
import { jsonAs, type ApiResponse } from '../../shared/http/contract'
import type { AudioPayload, Chat, ChatFilters, ChatsPage, ContactsPayload, CustomerServiceWindow, ForwardPayload, ForwardResult, InteractivePayload, InternalNote, LeadInput, LeadUpdateInput, LocationPayload, MediaPayload, MessageCursor, MessagePage, NoteInput, PageParam, ReactionPayload, ScheduledMessage, SendTemplatePayload, StickerPayload, TextPayload } from "./types";
import type { ContractMessage, Message, MessageAnalysis, MessageReaction } from '../whatsapp/types'

/** De lo que entrega el contrato a lo que usa el hilo (ver `Message`). */
export function toMessage(message: ContractMessage): Message {
  return {
    ...message,
    analysis: message.analysis === null ? null : jsonAs<MessageAnalysis>(message.analysis),
    reactions: message.reactions === null ? null : message.reactions.map(reaction => jsonAs<MessageReaction>(reaction)),
  }
}

export async function fetchChatsPage(search: string, pageParam: PageParam, filters?: ChatFilters): Promise<ChatsPage> {
  const params: Record<string, string> = {}
  if (search) params.search = search
  if (filters?.unreadOnly) params.unread_only = 'true'
  if (filters?.stages.length) params.stages = filters.stages.join(',')
  if (filters?.tagIds.length) params.tag_ids = filters.tagIds.join(',')
  if (filters?.tagIds.length) params.tag_mode = filters.tagMode
  if (filters?.service.trim()) params.service = filters.service.trim()
  if (filters?.sellerId) params.seller_id = String(filters.sellerId)
  if (filters?.origin.trim()) params.origin = filters.origin.trim()
  if (filters?.lastSender) params.last_sender = filters.lastSender
  if (filters?.inactiveDays) params.inactive_days = String(filters.inactiveDays)
  if (filters?.waitingTime) params.waiting_time = filters.waitingTime
  if (filters?.automationPaused) params.automation_paused = 'true'
  if (pageParam) {
    params.cursor_id = String(pageParam.cursorId)
    if (pageParam.cursorTs) params.cursor_ts = pageParam.cursorTs
    if (search) params.cursor_rank = String(pageParam.cursorRank ?? 2)
  }
  const { data } = await client.get<ApiResponse<'/api/chats', 'get'>>('/api/chats', { params })
  return data
}

export async function fetchLeadByPhone(digits: string): Promise<Chat | null> {
  const { data } = await client.get<ApiResponse<'/api/chats', 'get'>>('/api/chats', { params: { search: digits } })
  return data.items.find((chat) => (chat.phone ?? '').replace(/\D/g, '').endsWith(digits)) ?? null
}

export async function createLead(payload: LeadInput): Promise<Chat> {
  const { data } = await client.post<ApiResponse<'/api/chats', 'post'>>('/api/chats', payload)
  return data
}

export async function updateLead(chatId: string, payload: LeadUpdateInput): Promise<Chat> {
  const { data } = await client.patch<ApiResponse<'/api/chats/{chat_id}', 'patch'>>(`/api/chats/${encodeURIComponent(chatId)}`, payload)
  return data
}

export async function markNoShow(chatId: string): Promise<Chat> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/no-show', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/no-show`)
  return data
}

export async function deleteLead(chatId: string): Promise<void> {
  await client.delete<ApiResponse<'/api/chats/{chat_id}', 'delete'>>(`/api/chats/${encodeURIComponent(chatId)}`)
}

export async function mergeLead(chatId: string, otherId: string): Promise<Chat> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/merge', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/merge`, { other_id: otherId })
  return data
}

export async function markChatRead(chatId: string): Promise<void> {
  await client.post<ApiResponse<'/api/chats/{chat_id}/read', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/read`)
}

export async function markChatUnread(chatId: string): Promise<void> {
  await client.post<ApiResponse<'/api/chats/{chat_id}/unread', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/unread`)
}

export async function fetchChat(chatId: string | null): Promise<Chat> {
  return (await client.get<ApiResponse<'/api/chats/{chat_id}', 'get'>>(`/api/chats/${encodeURIComponent(chatId as string)}`)).data
}

export async function fetchUnreadCount() {
  return (await client.get<ApiResponse<'/api/chats/unread-count', 'get'>>('/api/chats/unread-count')).data.count
}

export async function fetchPhoneConfig(): Promise<{ default_country_code: string }> {
  return (await client.get<ApiResponse<'/api/chats/phone-config', 'get'>>('/api/chats/phone-config')).data
}

export async function fetchMessages(chatId: string, cursor: MessageCursor, untilId?: number | null): Promise<MessagePage> {
  const params: Record<string, string | number> = {}
  if (cursor) {
    params.cursor_ts = cursor.cursorTs
    params.cursor_id = cursor.cursorId
  } else if (untilId) {
    // Primera página al abrir desde un resultado de búsqueda por mensaje:
    // el backend la agranda hasta incluir el mensaje matcheado.
    params.until_id = untilId
  }
  const { data } = await client.get<ApiResponse<'/api/chats/{chat_id}/messages', 'get'>>(`/api/chats/${encodeURIComponent(chatId)}/messages`, { params })
  return { ...data, items: data.items.map(toMessage) }
}

export async function sendAudio(chatId: string, { contentType, dataBase64, replyTo }: AudioPayload): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/audio', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/audio`, {
    content_type: contentType,
    data_base64: dataBase64,
    reply_to_message_id: replyTo?.id ?? null,
  })
  return toMessage(data)
}

export async function sendMedia(chatId: string, { contentType, dataBase64, filename, caption, replyTo, albumId }: MediaPayload): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/media', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/media`, {
    content_type: contentType,
    data_base64: dataBase64,
    filename,
    caption: caption || null,
    reply_to_message_id: replyTo?.id ?? null,
    album_id: albumId || null,
  })
  return toMessage(data)
}

export async function sendSticker(chatId: string, { assetId }: StickerPayload): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/sticker', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/sticker`, {
    asset_id: assetId,
  })
  return toMessage(data)
}

export async function sendLocation(chatId: string, { latitude, longitude, replyTo }: LocationPayload): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/location', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/location`, {
    latitude,
    longitude,
    reply_to_message_id: replyTo?.id ?? null,
  })
  return toMessage(data)
}

export async function sendContacts(chatId: string, { contacts, replyTo }: ContactsPayload): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/contacts', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/contacts`, {
    contacts: contacts.map(contact => ({
      full_name: contact.fullName,
      phone_number: contact.phoneNumber,
    })),
    reply_to_message_id: replyTo?.id ?? null,
  })
  return toMessage(data)
}

export function sendMessage(chatId: string, { text, replyTo }: TextPayload): Promise<Message> {
  return orderedRequest(chatId, async () => {
    const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/messages', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
      text,
      reply_to_message_id: replyTo?.id ?? null,
    })
    return toMessage(data)
  })
}

export function retryFailedMessage(chatId: string, message: Message): Promise<Message> {
  return orderedRequest(chatId, async () => {
    const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/messages/{message_id}/retry', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/messages/${message.id}/retry`)
    return toMessage(data)
  })
}

export async function discardFailedMessage(chatId: string, message: Message): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/messages/{message_id}/discard', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/messages/${message.id}/discard`)
  return toMessage(data)
}

export function sendTemplate(chatId: string, { templateId, text, parameters = [] }: SendTemplatePayload): Promise<Message[]> {
  return orderedRequest(chatId, async () => {
    const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/templates/{template_id}', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/templates/${templateId}`, { text, parameters })
    return data.map(toMessage)
  })
}

export async function reactToMessage(chatId: string, { messageId, emoji }: ReactionPayload): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/messages/{message_id}/reaction', 'post'>>(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}/reaction`,
    { emoji },
  )
  return toMessage(data)
}

export async function fetchPinnedMessages(chatId: string | null): Promise<Message[]> {
  const { data } = await client.get<ApiResponse<'/api/chats/{chat_id}/pinned-messages', 'get'>>(
    `/api/chats/${encodeURIComponent(chatId as string)}/pinned-messages`,
  )
  return data.items.map(toMessage)
}

export async function pinMessage(chatId: string, messageId: number): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/messages/{message_id}/pin', 'post'>>(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}/pin`,
  )
  return toMessage(data)
}

export async function unpinMessage(chatId: string, messageId: number): Promise<Message> {
  const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/messages/{message_id}/unpin', 'post'>>(
    `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}/unpin`,
  )
  return toMessage(data)
}

export async function forwardMessages(chatId: string, { messageIds, targetChatIds }: ForwardPayload): Promise<ForwardResult> {
  return (await client.post<ApiResponse<'/api/chats/{chat_id}/messages/forward', 'post'>>(
        `/api/chats/${encodeURIComponent(chatId)}/messages/forward`,
        { message_ids: messageIds, target_chat_ids: targetChatIds },
      )).data
}

export function sendInteractive(chatId: string, { interactive, replyTo }: InteractivePayload): Promise<Message> {
  return orderedRequest(chatId, async () => {
    const { data } = await client.post<ApiResponse<'/api/chats/{chat_id}/interactive', 'post'>>(`/api/chats/${encodeURIComponent(chatId)}/interactive`, {
      interactive,
      reply_to_message_id: replyTo?.id ?? null,
    })
    return toMessage(data)
  })
}

export async function fetchInternalNotes(chatId: string | null): Promise<InternalNote[]> {
  return (await client.get<ApiResponse<'/api/chats/{chat_id}/notes', 'get'>>(`/api/chats/${encodeURIComponent(chatId as string)}/notes`)).data
}

export async function createInternalNote(chatId: string, input: NoteInput): Promise<InternalNote> {
  return (await client.post<ApiResponse<'/api/chats/{chat_id}/notes', 'post'>>(
      `/api/chats/${encodeURIComponent(chatId)}/notes`,
      { content: input.content, mentioned_user_ids: input.mentionedUserIds },
    )).data
}

export async function updateInternalNote(chatId: string, { id, ...input }: NoteInput & { id: number }): Promise<InternalNote> {
  return (await client.patch<ApiResponse<'/api/chats/{chat_id}/notes/{note_id}', 'patch'>>(
      `/api/chats/${encodeURIComponent(chatId)}/notes/${id}`,
      { content: input.content, mentioned_user_ids: input.mentionedUserIds },
    )).data
}

export async function deleteInternalNote(chatId: string, id: number) { await client.delete<ApiResponse<'/api/chats/{chat_id}/notes/{note_id}', 'delete'>>(`/api/chats/${encodeURIComponent(chatId)}/notes/${id}`) }

export async function fetchCustomerServiceWindow(chatId: string | null): Promise<CustomerServiceWindow> {
  return (await client.get<ApiResponse<'/api/chats/{chat_id}/service-window', 'get'>>(
      `/api/chats/${encodeURIComponent(chatId as string)}/service-window`,
    )).data
}

export async function fetchScheduledMessages(chatId: string): Promise<ScheduledMessage[]> {
  return (
      await client.get<ApiResponse<'/api/chats/{chat_id}/scheduled-messages', 'get'>>(
        `/api/chats/${encodeURIComponent(chatId)}/scheduled-messages`,
      )
    ).data
}

export async function createScheduledMessage(chatId: string, { text, scheduledAt }: { text: string; scheduledAt: string }): Promise<ScheduledMessage> {
  return (
      await client.post<ApiResponse<'/api/chats/{chat_id}/scheduled-messages', 'post'>>(
        `/api/chats/${encodeURIComponent(chatId)}/scheduled-messages`,
        { text, scheduled_at: scheduledAt },
      )
    ).data
}

export async function cancelScheduledMessage(scheduledId: number) {
  await client.delete<ApiResponse<'/api/scheduled-messages/{scheduled_id}', 'delete'>>(`/api/scheduled-messages/${scheduledId}`)
}

/** Los requests se serializan por chat, pero todas las burbujas aparecen de
 * inmediato. Así se conserva el orden de pulsación incluso si una carga de
 * archivo tarda más que el texto que se escribió después. */
export function orderedRequest<T>(chatId: string, request: () => Promise<T>): Promise<T> {
  const previous = requestTails.get(chatId) ?? Promise.resolve()
  const current = previous.then(request)
  const tail = current.then(() => undefined, () => undefined)
  requestTails.set(chatId, tail)
  void tail.finally(() => {
    if (requestTails.get(chatId) === tail) requestTails.delete(chatId)
  })
  return current
}
