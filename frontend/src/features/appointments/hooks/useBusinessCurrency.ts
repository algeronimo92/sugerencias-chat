import { useQuery } from '@tanstack/react-query'
import { fetchBusinessCurrency } from '../api'
import { appointmentKeys } from '../keys'

/** La moneda cambia casi nunca: se pide una vez por sesión. Si falla, el
 *  formulario sigue funcionando, solo que sin símbolo junto al adelanto. */
export function useBusinessCurrency(): string | null {
  const { data } = useQuery({
    queryKey: appointmentKeys.businessCurrency,
    queryFn: fetchBusinessCurrency,
    staleTime: Infinity,
    retry: false,
  })
  return data ?? null
}
