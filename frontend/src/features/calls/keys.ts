/** Claves de caché de las llamadas de WhatsApp. */
export const callKeys = {
  all: ['calls'] as const,
  ringing: ['calls', 'ringing'] as const,
  chat: (chatId: string) => ['calls', 'chat', chatId] as const,
  permission: (chatId: string) => ['calls', 'permission', chatId] as const,
}
