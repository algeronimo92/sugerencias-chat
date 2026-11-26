import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FEATURE_LABELS, FEATURES } from '../../../../../shared/plan'
import { Button } from '../../../../../shared/ui/Button'
import { fetchOrganizationPlan, fetchPlans, saveOrganizationPlan } from '../../../api'
import { platformKeys } from '../../../keys'
import type { Organization, Paquete, PaqueteId } from '../../../types'
import { mensajeDeError } from '../errors'
import { Tarjeta } from '../PanelUi'

function tope(valor: number | null | undefined, unidad: string): string {
  return valor == null ? `Sin límite de ${unidad}` : `Hasta ${valor} ${unidad}`
}

function resumen(paquete: Paquete): string[] {
  const incluidas = new Set<string>(paquete.features)
  const funciones = FEATURES.filter((feature) => incluidas.has(feature)).map((feature) => FEATURE_LABELS[feature])
  return [
    tope(paquete.max_seats, 'personas atendiendo'),
    paquete.max_active_automations == null
      ? 'Automatizaciones sin límite'
      : `${paquete.max_active_automations} automatizaciones encendidas a la vez`,
    paquete.ai_enabled ? `IA: ${paquete.ai_monthly_quota ?? 'sin límite de'} generaciones al mes` : 'Sin IA',
    ...funciones,
  ]
}

/** El paquete que paga el negocio. Cambiarlo también le pone la IA de ese
 *  paquete; una excepción se da después en "Asistente IA". */
export function BusinessPlan({ organizacion }: { organizacion: Organization }) {
  const queryClient = useQueryClient()
  const clave = platformKeys.plan(organizacion.id)
  const catalogo = useQuery({ queryKey: platformKeys.plans, queryFn: fetchPlans, staleTime: Infinity })
  const actual = useQuery({ queryKey: clave, queryFn: async () => await fetchOrganizationPlan(organizacion) })
  const [elegido, setElegido] = useState<PaqueteId>(organizacion.plan)

  useEffect(() => {
    if (actual.data) setElegido(actual.data.plan)
  }, [actual.data])

  const guardar = useMutation({
    mutationFn: async (plan: PaqueteId) => await saveOrganizationPlan(organizacion, plan),
    onSuccess: (data) => {
      queryClient.setQueryData(clave, data)
      queryClient.invalidateQueries({ queryKey: platformKeys.ai(organizacion.id), exact: true })
      queryClient.invalidateQueries({ queryKey: platformKeys.organizations, exact: true })
    },
  })

  const sinCambios = actual.data?.plan === elegido

  return (
    <Tarjeta
      titulo="Paquete"
      descripcion="Qué funciones y topes tiene el negocio. Bajar de paquete no borra nada: si queda por encima de un tope, solo no puede sumar más."
      className="max-w-3xl"
    >
      {(catalogo.isError || actual.isError) && (
        <p role="alert" className="text-xs text-red-600 dark:text-red-300">{mensajeDeError(catalogo.error ?? actual.error)}</p>
      )}
      {catalogo.isLoading && <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando paquetes…</p>}
      <form
        onSubmit={(evento) => {
          evento.preventDefault()
          guardar.mutate(elegido)
        }}
      >
        <fieldset className="grid gap-3 sm:grid-cols-3">
          <legend className="sr-only">Paquete del negocio</legend>
          {catalogo.data?.map((paquete) => {
            const activo = elegido === paquete.id
            return (
              <label
                key={paquete.id}
                className={`flex cursor-pointer flex-col gap-2 rounded-lg border p-3 text-sm transition-colors ${
                  activo
                    ? 'border-wa-primary bg-wa-primary/5 dark:border-wa-primary'
                    : 'border-wa-border hover:border-wa-primary/60 dark:border-wa-border-dark'
                }`}
              >
                <span className="flex items-center gap-2 font-semibold text-wa-text dark:text-wa-text-dark">
                  <input
                    type="radio"
                    name={`paquete-${organizacion.id}`}
                    value={paquete.id}
                    checked={activo}
                    onChange={() => setElegido(paquete.id)}
                    className="h-4 w-4 accent-wa-primary"
                  />
                  {paquete.name}
                  {actual.data?.plan === paquete.id && (
                    <span className="ml-auto rounded bg-wa-border px-1.5 py-0.5 text-[11px] font-medium text-wa-muted dark:bg-wa-border-dark dark:text-wa-muted-dark">
                      Actual
                    </span>
                  )}
                </span>
                <ul className="space-y-1 text-xs leading-5 text-wa-muted dark:text-wa-muted-dark">
                  {resumen(paquete).map((linea) => <li key={linea}>{linea}</li>)}
                </ul>
              </label>
            )
          })}
        </fieldset>
        {guardar.isError && (
          <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{mensajeDeError(guardar.error)}</p>
        )}
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-wa-border pt-4 dark:border-wa-border-dark">
          {guardar.isSuccess && sinCambios && (
            <span role="status" className="text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">Guardado</span>
          )}
          <Button type="submit" disabled={guardar.isPending || actual.isLoading || sinCambios}>
            {guardar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Cambiar paquete
          </Button>
        </div>
      </form>
    </Tarjeta>
  )
}
