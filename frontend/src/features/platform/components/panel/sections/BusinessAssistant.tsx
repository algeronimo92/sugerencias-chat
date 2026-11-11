import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button } from '../../../../../shared/ui/Button'
import { Input } from '../../../../../shared/ui/Input'
import { fetchOrganizationAi, saveOrganizationAi } from '../../../api'
import { platformKeys } from '../../../keys'
import type { Organization } from '../../../types'
import { mensajeDeError } from '../errors'
import { Tarjeta, campoPanelClass } from '../PanelUi'

/** Lo que el operador decide por negocio y el negocio no puede tocar: si tiene
 *  el asistente IA y con qué cuota. La lectura entra al schema del negocio. */
export function BusinessAssistant({ organizacion }: { organizacion: Organization }) {
  const formId = useId()
  const queryClient = useQueryClient()
  const [habilitado, setHabilitado] = useState(organizacion.ai_enabled)
  const [cuota, setCuota] = useState(() => organizacion.ai_monthly_quota?.toString() ?? '')
  const [errorCuota, setErrorCuota] = useState<string | null>(null)
  const clave = platformKeys.ai(organizacion.id)

  const asistente = useQuery({ queryKey: clave, queryFn: async () => await fetchOrganizationAi(organizacion) })

  useEffect(() => {
    if (!asistente.data) return
    setHabilitado(asistente.data.enabled)
    setCuota(asistente.data.monthly_quota?.toString() ?? '')
  }, [asistente.data])

  const guardar = useMutation({
    mutationFn: async (monthlyQuota: number | null) => await saveOrganizationAi(organizacion, habilitado, monthlyQuota),
    onSuccess: (data) => {
      queryClient.setQueryData(clave, data)
      queryClient.invalidateQueries({ queryKey: platformKeys.organizations, exact: true })
    },
  })

  return (
    <Tarjeta
      titulo="Asistente IA"
      descripcion="Sugerencias y analista usan los workflows de la plataforma. La cuota cuenta generaciones por mes (UTC); vacía es sin límite."
      className="max-w-2xl"
    >
      <form
        onSubmit={(evento) => {
          evento.preventDefault()
          const texto = cuota.trim()
          const valor = texto === '' ? null : Number(texto)
          if (valor !== null && (!Number.isInteger(valor) || valor < 0)) {
            setErrorCuota('La cuota debe ser un número entero mayor o igual a cero.')
            return
          }
          setErrorCuota(null)
          guardar.mutate(valor)
        }}
      >
        {asistente.isLoading && <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando uso…</p>}
        {asistente.isError && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{mensajeDeError(asistente.error)}</p>}
        {asistente.data && (
          <p className="text-sm text-wa-text dark:text-wa-text-dark">
            Este mes: <span className="font-semibold">{asistente.data.used_this_month}</span>
            {asistente.data.monthly_quota !== null && ` de ${asistente.data.monthly_quota}`} generaciones
          </p>
        )}
        <label className="mt-4 flex min-h-10 items-center gap-2 text-sm text-wa-text dark:text-wa-text-dark">
          <input
            type="checkbox"
            checked={habilitado}
            onChange={(evento) => setHabilitado(evento.target.checked)}
            className="h-4 w-4 accent-wa-primary"
          />
          Habilitado para este negocio
        </label>
        <label htmlFor={`${formId}-cuota`} className="mt-3 block text-xs font-semibold text-wa-text dark:text-wa-text-dark">
          Cuota mensual
        </label>
        <Input
          id={`${formId}-cuota`}
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={cuota}
          onChange={(evento) => setCuota(evento.target.value)}
          placeholder="Sin límite"
          aria-invalid={errorCuota !== null}
          className={`mt-1.5 max-w-40 ${campoPanelClass}`}
        />
        {(errorCuota || guardar.isError) && (
          <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">
            {errorCuota ?? mensajeDeError(guardar.error)}
          </p>
        )}
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-wa-border pt-4 dark:border-wa-border-dark">
          {guardar.isSuccess && <span role="status" className="text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">Guardado</span>}
          <Button type="submit" disabled={guardar.isPending || asistente.isLoading}>
            {guardar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Guardar asistente
          </Button>
        </div>
      </form>
    </Tarjeta>
  )
}
