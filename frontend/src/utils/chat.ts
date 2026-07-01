import type { Chat } from '../types'

export function phoneFromChatId(chatId: string): string {
  const digits = chatId.split('@')[0]
  return `+${digits}`
}

export function displayName(chat: Chat): string {
  return chat.name ?? chat.phone ?? phoneFromChatId(chat.chat_id)
}

export function displayPhone(chat: Chat): string {
  return chat.phone ?? phoneFromChatId(chat.chat_id)
}

export function avatarInitial(chat: Chat): string {
  return chat.name?.[0]?.toUpperCase() ?? '#'
}
