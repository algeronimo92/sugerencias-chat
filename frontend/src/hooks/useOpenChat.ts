import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Chat } from '../types'

export function useOpenChat() {
  const navigate = useNavigate()
  return useCallback((chat: Chat) => {
    // Resultado de búsqueda que matcheó por un mensaje del historial: se pasa
    // el id por el estado de navegación para saltar hasta él y resaltarlo.
    if (chat.search_rank === 0 && chat.matched_message_id) {
      navigate(`/chat/${chat.chat_id}`, { state: { highlightMessageId: chat.matched_message_id } })
    } else {
      navigate(`/chat/${chat.chat_id}`)
    }
  }, [navigate])
}
