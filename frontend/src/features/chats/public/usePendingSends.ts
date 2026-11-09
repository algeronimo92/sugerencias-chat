import { useIsMutating } from '@tanstack/react-query'
import { messageKeys } from '../keys'

/** Cuántos envíos de mensajes hay en vuelo, de cualquier chat. Lo consulta la
 * actualización de la app antes de recargar: un envío a medias se perdería. */
export function usePendingSends(): number {
  return useIsMutating({ mutationKey: messageKeys.sendingAny })
}
