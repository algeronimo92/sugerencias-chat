import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { markChatRead, markChatUnread } from './api'
import type { ChatsPage } from '../leads/types'
import { leadKeys } from '../leads/public/keys'

/** Marca un chat como visto — resetea su unread_count. Se llama al abrirlo.
 *
 * Parchea la caché en vez de invalidar leadKeys.all: invalidar reordena la
 * lista completa (por actividad/no-leídos) mientras en móvil sigue montada
 * pero oculta detrás del chat abierto. Como esto se dispara en casi cada
 * entrada a un lead, el usuario volvía a la lista con el scroll "saltado"
 * a leads distintos de los que había dejado en esa posición. */
export function useMarkChatRead() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markChatRead,
    onSuccess: (_data, chatId) => {
      queryClient.setQueriesData<InfiniteData<ChatsPage>>(
        { queryKey: leadKeys.lists },
        (current) => {
          if (!current) return current
          return {
            ...current,
            pages: current.pages.map((page) => ({
              ...page,
              items: page.items.map((item) =>
                item.chat_id === chatId ? { ...item, unread_count: 0 } : item
              ),
            })),
          }
        }
      )
      queryClient.invalidateQueries({ queryKey: leadKeys.unreadCount })
    },
  })
}

/** Marca manualmente un chat como pendiente sin cambiar los recibos de WhatsApp. */
export function useMarkChatUnread() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: markChatUnread,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: leadKeys.all })
      queryClient.invalidateQueries({ queryKey: leadKeys.unreadCount })
    },
  })
}
