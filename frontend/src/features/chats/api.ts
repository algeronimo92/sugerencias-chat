const requestTails = new Map<string, Promise<void>>()
import client from "../../shared/http/client";
import type { TemplateCategory } from "../leads/types";
import type { AudioPayload,Chat,ChatFilters,ChatsPage,ContactsPayload,CustomerServiceWindow,ForwardPayload,ForwardResult,InteractivePayload,InternalNote,LeadInput,LeadUpdateInput,LocationPayload,MediaPayload,Message,MessageCursor,MessagePage,MessageTemplate,MetaTemplateRaw,NoteInput,PageParam,ReactionPayload,ScheduledMessage,SendTemplatePayload,StickerPayload,TemplateAttachment,TemplateCapabilities,TemplateInput,TextPayload } from "./types";

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
  const { data } = await client.get<ChatsPage>('/api/chats', { params })
  return data
}

export async function fetchLeadByPhone(digits: string): Promise<Chat | null> {
  const { data } = await client.get<ChatsPage>('/api/chats', { params: { search: digits } })
  return data.items.find((chat) => (chat.phone ?? '').replace(/\D/g, '').endsWith(digits)) ?? null
}

export async function createLead(payload: LeadInput): Promise<Chat> {
  const { data } = await client.post<Chat>('/api/chats', payload)
  return data
}

export async function updateLead(chatId: string, payload: LeadUpdateInput): Promise<Chat> {
  const { data } = await client.patch<Chat>(`/api/chats/${encodeURIComponent(chatId)}`, payload)
  return data
}

export async function markNoShow(chatId: string): Promise<Chat> {
  const { data } = await client.post<Chat>(`/api/chats/${encodeURIComponent(chatId)}/no-show`)
  return data
}

export async function deleteLead(chatId: string): Promise<void> {
  await client.delete(`/api/chats/${encodeURIComponent(chatId)}`)
}

export async function mergeLead(chatId: string, otherId: string): Promise<Chat> {
  const { data } = await client.post<Chat>(`/api/chats/${encodeURIComponent(chatId)}/merge`, { other_id: otherId })
  return data
}

export async function markChatRead(chatId: string): Promise<void> {
  await client.post(`/api/chats/${encodeURIComponent(chatId)}/read`)
}

export async function markChatUnread(chatId: string): Promise<void> {
  await client.post(`/api/chats/${encodeURIComponent(chatId)}/unread`)
}

export function requestChat(chatId: string | null) {
  return async () => (await client.get<Chat>(`/api/chats/${encodeURIComponent(chatId as string)}`)).data
}

export function requestUnreadCount() {
  return async () => (await client.get<{ count: number }>('/api/chats/unread-count')).data.count
}

export function requestPhoneConfig() {
  return async () =>
      (await client.get<{ default_country_code: string }>('/api/chats/phone-config')).data
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
  const { data } = await client.get<MessagePage>(`/api/chats/${encodeURIComponent(chatId)}/messages`, { params })
  return data
}

export async function sendAudio(chatId: string, { contentType, dataBase64, replyTo }: AudioPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/audio`, {
    content_type: contentType,
    data_base64: dataBase64,
    reply_to_message_id: replyTo?.id ?? null,
  })
  return data
}

export async function sendMedia(chatId: string, { contentType, dataBase64, filename, caption, replyTo, albumId }: MediaPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/media`, {
    content_type: contentType,
    data_base64: dataBase64,
    filename,
    caption: caption || null,
    reply_to_message_id: replyTo?.id ?? null,
    album_id: albumId || null,
  })
  return data
}

export async function sendSticker(chatId: string, { assetId }: StickerPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/sticker`, {
    asset_id: assetId,
  })
  return data
}

export async function sendLocation(chatId: string, { latitude, longitude, replyTo }: LocationPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/location`, {
    latitude,
    longitude,
    reply_to_message_id: replyTo?.id ?? null,
  })
  return data
}

export async function sendContacts(chatId: string, { contacts, replyTo }: ContactsPayload): Promise<Message> {
  const { data } = await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/contacts`, {
    contacts: contacts.map(contact => ({
      full_name: contact.fullName,
      phone_number: contact.phoneNumber,
    })),
    reply_to_message_id: replyTo?.id ?? null,
  })
  return data
}

export function requestSendMessage(chatId: string) {
  return ({ text, replyTo }: TextPayload) => orderedRequest(chatId, async () => (
      await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/messages`, {
        text,
        reply_to_message_id: replyTo?.id ?? null,
      })
    ).data)
}

export function requestSendMessage1(chatId: string) {
  return (message: Message) => orderedRequest(chatId, async () => (
      await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/messages/${message.id}/retry`)
    ).data)
}

export function requestSendMessage2(chatId: string) {
  return async (message: Message) => (
      await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/messages/${message.id}/discard`)
    ).data
}

export function requestSendTemplate(chatId: string) {
  return ({ templateId, text, parameters = [] }: SendTemplatePayload) => orderedRequest(chatId, async () =>
      (await client.post<Message[]>(`/api/chats/${encodeURIComponent(chatId)}/templates/${templateId}`, { text, parameters })).data)
}

export function requestReactToMessage(chatId: string) {
  return async ({ messageId, emoji }: ReactionPayload) =>
      (await client.post<Message>(
        `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}/reaction`,
        { emoji },
      )).data
}

export function requestPinnedMessages(chatId: string | null) {
  return async () => (await client.get<{ items: Message[] }>(
      `/api/chats/${encodeURIComponent(chatId as string)}/pinned-messages`,
    )).data.items
}

export function requestPinMessage(chatId: string) {
  return async (messageId: number) => (await client.post<Message>(
      `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}/pin`,
    )).data
}

export function requestUnpinMessage(chatId: string) {
  return async (messageId: number) => (await client.post<Message>(
      `/api/chats/${encodeURIComponent(chatId)}/messages/${messageId}/unpin`,
    )).data
}

export function requestForwardMessages(chatId: string) {
  return async ({ messageIds, targetChatIds }: ForwardPayload) =>
      (await client.post<ForwardResult>(
        `/api/chats/${encodeURIComponent(chatId)}/messages/forward`,
        { message_ids: messageIds, target_chat_ids: targetChatIds },
      )).data
}

export function requestSendInteractive(chatId: string) {
  return ({ interactive, replyTo }: InteractivePayload) => orderedRequest(chatId, async () => (
      await client.post<Message>(`/api/chats/${encodeURIComponent(chatId)}/interactive`, {
        interactive,
        reply_to_message_id: replyTo?.id ?? null,
      })
    ).data)
}

export function requestTemplates(includeInactive: boolean) {
  return async () => (await client.get<MessageTemplate[]>('/api/templates', { params: { include_inactive: includeInactive } })).data
}

export function requestTemplateCapabilities() {
  return async () => (await client.get<TemplateCapabilities>('/api/templates/capabilities')).data
}

export function requestCreateTemplate() {
  return async (input: TemplateInput) => (await client.post<MessageTemplate>('/api/templates', input)).data
}

export function requestUpdateTemplate() {
  return async ({ id, ...input }: Partial<MessageTemplate> & { id: number }) => (await client.patch<MessageTemplate>(`/api/templates/${id}`, input)).data
}

export function requestCreatePersonalTemplate() {
  return async (input: { name: string; content: string; shortcut?: string | null }) =>
      (await client.post<MessageTemplate>('/api/templates/personal', input)).data
}

export function requestToggleTemplateFavorite() {
  return async ({ id, isFavorite }: { id: number; isFavorite: boolean }) => {
      await client.put(`/api/templates/${id}/favorite`, { is_favorite: isFavorite })
    }
}

export function requestRecordTemplateUse() {
  return async (id: number) => { await client.post(`/api/templates/${id}/use`) }
}

export function requestUploadTemplateAttachment() {
  return async ({ templateId, contentType, dataBase64, filename }: { templateId: number; contentType: string; dataBase64: string; filename: string }) =>
      (await client.post<TemplateAttachment>(`/api/templates/${templateId}/attachments`, {
        content_type: contentType, data_base64: dataBase64, filename,
      })).data
}

export function requestAddLibraryTemplateAttachment() {
  return async ({ templateId, assetId }: { templateId: number; assetId: number }) =>
      (await client.post<TemplateAttachment>(`/api/templates/${templateId}/attachments/library`, {
        asset_id: assetId,
      })).data
}

export function requestDeleteTemplateAttachment() {
  return async (id: number) => { await client.delete(`/api/templates/attachments/${id}`) }
}

export function requestMetaTemplates() {
  return async () => (await client.get<MetaTemplateRaw[]>('/api/templates/meta')).data
}

export function requestMetaTemplateDetail(metaTemplateId: string | null) {
  return async () => (await client.get<MetaTemplateRaw>(`/api/templates/meta/${metaTemplateId}`)).data
}

export function requestImportMetaTemplate() {
  return async ({ metaTemplateId, name, category, shortcut, officialParameterValues }: {
      metaTemplateId: string
      name: string
      category: string
      shortcut: string | null
      officialParameterValues: string[]
    }) => (await client.post<MessageTemplate>(`/api/templates/meta/${metaTemplateId}/import`, {
      name, category, shortcut, official_parameter_values: officialParameterValues,
    })).data
}

export function requestSyncTemplate() {
  return async (id: number) => (await client.post<MessageTemplate>(`/api/templates/${id}/sync`)).data
}

export function requestDeleteTemplate() {
  return async (id: number) => { await client.delete(`/api/templates/${id}`) }
}

export function requestInternalNotes(chatId: string | null) {
  return async () => (await client.get<InternalNote[]>(`/api/chats/${encodeURIComponent(chatId as string)}/notes`)).data
}

export function requestCreateInternalNote(chatId: string) {
  return async (input: NoteInput) => (await client.post<InternalNote>(
      `/api/chats/${encodeURIComponent(chatId)}/notes`,
      { content: input.content, mentioned_user_ids: input.mentionedUserIds },
    )).data
}

export function requestUpdateInternalNote(chatId: string) {
  return async ({ id, ...input }: NoteInput & { id: number }) => (await client.patch<InternalNote>(
      `/api/chats/${encodeURIComponent(chatId)}/notes/${id}`,
      { content: input.content, mentioned_user_ids: input.mentionedUserIds },
    )).data
}

export function requestDeleteInternalNote(chatId: string) {
  return async (id: number) => { await client.delete(`/api/chats/${encodeURIComponent(chatId)}/notes/${id}`) }
}

export function requestCustomerServiceWindow(chatId: string | null) {
  return async () => (await client.get<CustomerServiceWindow>(
      `/api/chats/${encodeURIComponent(chatId as string)}/service-window`,
    )).data
}

export function requestScheduledMessages(chatId: string) {
  return async () => (
      await client.get<ScheduledMessage[]>(
        `/api/chats/${encodeURIComponent(chatId)}/scheduled-messages`,
      )
    ).data
}

export function requestCreateScheduledMessage(chatId: string) {
  return async ({ text, scheduledAt }: { text: string; scheduledAt: string }) => (
      await client.post<ScheduledMessage>(
        `/api/chats/${encodeURIComponent(chatId)}/scheduled-messages`,
        { text, scheduled_at: scheduledAt },
      )
    ).data
}

export function requestCancelScheduledMessage() {
  return async (scheduledId: number) => {
      await client.delete(`/api/scheduled-messages/${scheduledId}`)
    }
}

export function requestTemplateCategories(includeInactive: boolean) {
  return async () => (
      await client.get<TemplateCategory[]>(
        includeInactive ? '/api/template-categories/all' : '/api/template-categories',
      )
    ).data
}

export function requestCreateTemplateCategory() {
  return async (name: string) => (
      await client.post<TemplateCategory>('/api/template-categories', { name })
    ).data
}

export function requestUpdateTemplateCategory() {
  return async ({ id, ...values }: { id: number; name?: string; is_active?: boolean }) => (
      await client.patch<TemplateCategory>(`/api/template-categories/${id}`, values)
    ).data
}

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
