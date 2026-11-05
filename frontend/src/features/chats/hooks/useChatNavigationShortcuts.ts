import { useEffect, useRef } from 'react'
import type { Chat } from '../../leads/types'

/**
 * Alt+↓ / Alt+↑ abren el chat siguiente o el anterior de la lista visible.
 *
 * Con Alt (y no J/K sueltas) funcionan también con el cursor en el
 * compositor: el vendedor responde y salta al siguiente sin tocar el mouse.
 * Respeta los filtros y vistas activos porque recorre la lista tal como se ve.
 */
export function useChatNavigationShortcuts(chats: Chat[], selectedId: string | null, onSelect: (chat: Chat) => void) {
  // Refs para no re-suscribir el listener en cada render de la lista.
  const latest = useRef({ chats, selectedId, onSelect })
  useEffect(() => {
    latest.current = { chats, selectedId, onSelect }
  })

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
      const { chats: list, selectedId: current, onSelect: open } = latest.current
      if (list.length === 0) return
      event.preventDefault()
      const index = list.findIndex((chat) => chat.chat_id === current)
      const next = index === -1
        ? list[0]
        : list[Math.min(Math.max(index + (event.key === 'ArrowDown' ? 1 : -1), 0), list.length - 1)]
      if (next.chat_id !== current) open(next)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
