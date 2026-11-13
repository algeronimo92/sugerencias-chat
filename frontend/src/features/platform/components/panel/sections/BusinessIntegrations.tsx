import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Button } from '../../../../../shared/ui/Button'
import { Input } from '../../../../../shared/ui/Input'
import { fetchOrganizationIntegrations, saveOrganizationIntegrations } from '../../../api'
import { platformKeys } from '../../../keys'
import type { Organization } from '../../../types'
import { mensajeDeError } from '../errors'
import { Tarjeta, campoPanelClass } from '../PanelUi'

/** Workflows que el operador carga para un negocio en particular (hoy, el de
 *  citas). Las credenciales comunes a todos viven en "Integraciones" de la
 *  plataforma, no acá. */
export function BusinessIntegrations({ organizacion }: { organizacion: Organization }) {
  const formId = useId()
  const queryClient = useQueryClient()
  const [valores, setValores] = useState<Record<string, string>>({})
  const clave = platformKeys.integrations(organizacion.id)

  const integraciones = useQuery({ queryKey: clave, queryFn: async () => await fetchOrganizationIntegrations(organizacion) })

  useEffect(() => {
    if (!integraciones.data) return
    setValores(Object.fromEntries(integraciones.data.map((item) => [item.key, item.value ?? ''])))
  }, [integraciones.data])

  const guardar = useMutation({
    mutationFn: async () => await saveOrganizationIntegrations(organizacion, valores),
    onSuccess: (data) => queryClient.setQueryData(clave, data),
  })

  return (
    <Tarjeta
      titulo="Integraciones del negocio"
      descripcion="Workflows propios de este negocio. El negocio los usa, pero no los ve ni los edita."
      className="max-w-2xl"
    >
      <form
        onSubmit={(evento) => {
          evento.preventDefault()
          guardar.mutate()
        }}
      >
        {integraciones.isLoading && <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando…</p>}
        {integraciones.isError && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{mensajeDeError(integraciones.error)}</p>}
        <div className="space-y-3">
          {integraciones.data?.map((item) => (
            <div key={item.key}>
              <label htmlFor={`${formId}-${item.key}`} className="block text-xs font-semibold text-wa-text dark:text-wa-text-dark">
                {item.label}
              </label>
              <Input
                id={`${formId}-${item.key}`}
                type="url"
                value={valores[item.key] ?? ''}
                onChange={(evento) => setValores((actual) => ({ ...actual, [item.key]: evento.target.value }))}
                placeholder="https://n8n.ejemplo.com/webhook/…"
                autoComplete="off"
                className={`mt-1.5 ${campoPanelClass}`}
              />
            </div>
          ))}
        </div>
        {guardar.isError && (
          <p role="alert" className="mt-3 text-xs text-red-600 dark:text-red-300">{mensajeDeError(guardar.error)}</p>
        )}
        <div className="mt-5 flex items-center justify-end gap-3 border-t border-wa-border pt-4 dark:border-wa-border-dark">
          {guardar.isSuccess && <span role="status" className="text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">Guardado</span>}
          <Button type="submit" disabled={guardar.isPending || !integraciones.data}>
            {guardar.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
            Guardar integraciones
          </Button>
        </div>
      </form>
    </Tarjeta>
  )
}
