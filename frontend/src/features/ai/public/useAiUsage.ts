import { useAiUsage } from '../queries'

/**
 * Si el negocio tiene IA. Mientras no se sabe cuenta como sí: esconder el
 * Copiloto y que reaparezca al cargar es peor que lo contrario, y el backend
 * igual responde con el motivo si no la tiene.
 */
export function useAiAvailable(): boolean {
  const { data } = useAiUsage()
  return data?.enabled ?? true
}
