import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Loader2, Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { Input } from '../../../../../shared/ui/Input'
import { addOrganizationDomain, removeOrganizationDomain } from '../../../api'
import { platformKeys } from '../../../keys'
import type { Organization } from '../../../types'
import { mensajeDeError } from '../errors'
import { Tarjeta, campoPanelClass } from '../PanelUi'

/** Dominios por los que entra el negocio. El principal no se quita desde acá:
 *  es el que usa el operador para actuar sobre su espacio. */
export function BusinessDomains({ organizacion }: { organizacion: Organization }) {
  const queryClient = useQueryClient()
  const [hostname, setHostname] = useState('')
  const campoId = useId()
  const refrescar = () => queryClient.invalidateQueries({ queryKey: platformKeys.organizations })

  const agregar = useMutation({
    mutationFn: async () => {
      await addOrganizationDomain(organizacion, hostname)
    },
    onSuccess: () => {
      setHostname('')
      refrescar()
    },
  })

  const quitar = useMutation({
    mutationFn: async (valor: string) => {
      await removeOrganizationDomain(organizacion, valor)
    },
    onSuccess: refrescar,
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Tarjeta
        titulo="Dominios configurados"
        descripcion="El negocio abre su CRM por cualquiera de estos dominios."
        accion={
          <span className="rounded-full bg-wa-field px-2 py-0.5 text-xs font-semibold text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
            {organizacion.domains.length}
          </span>
        }
      >
        <ul className="divide-y divide-wa-border dark:divide-wa-border-dark">
          {organizacion.domains.map((domain) => (
            <li key={domain.id} className="flex min-h-12 items-center gap-2.5 py-1.5 text-sm font-medium text-wa-text dark:text-wa-text-dark">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${domain.is_primary ? 'bg-emerald-500' : 'bg-gray-400'}`} aria-hidden="true" />
              <span className="min-w-0 break-all">{domain.hostname}</span>
              {domain.is_primary ? (
                <span className="ml-auto shrink-0 rounded bg-emerald-500/10 px-1.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">Principal</span>
              ) : (
                <button
                  type="button"
                  onClick={() => quitar.mutate(domain.hostname)}
                  disabled={quitar.isPending}
                  className="ml-auto flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-wa-muted transition hover:bg-red-500/10 hover:text-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:opacity-50 dark:text-wa-muted-dark dark:hover:text-red-300"
                  aria-label={`Quitar ${domain.hostname}`}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </button>
              )}
            </li>
          ))}
        </ul>
        {quitar.isError && (
          <p role="alert" className="mt-2 text-sm font-medium text-red-600 dark:text-red-300">{mensajeDeError(quitar.error)}</p>
        )}
      </Tarjeta>

      <Tarjeta titulo="Añadir un dominio" descripcion="Apunta primero el DNS del dominio a la plataforma; después agrégalo acá.">
        <form
          className="flex flex-col gap-3"
          onSubmit={(evento) => {
            evento.preventDefault()
            agregar.mutate()
          }}
        >
          <div>
            <label htmlFor={campoId} className="mb-1.5 block text-sm font-medium text-wa-text dark:text-wa-text-dark">Nuevo dominio</label>
            <Input id={campoId} className={campoPanelClass} value={hostname} onChange={(evento) => setHostname(evento.target.value)} placeholder="nuevo-dominio.com" required aria-invalid={agregar.isError} />
          </div>
          <button
            type="submit"
            disabled={!hostname.trim() || agregar.isPending}
            className="inline-flex h-10 items-center justify-center gap-1.5 self-start rounded-lg border border-wa-border px-3.5 text-sm font-semibold text-wa-text transition hover:border-wa-primary/40 hover:bg-wa-primary/5 hover:text-wa-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:cursor-not-allowed disabled:opacity-50 dark:border-wa-border-dark dark:text-wa-text-dark dark:hover:text-wa-primary"
          >
            {agregar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}
            Añadir dominio
          </button>
          {agregar.isError && (
            <p role="alert" className="text-sm font-medium text-red-600 dark:text-red-300">{mensajeDeError(agregar.error)}</p>
          )}
        </form>
      </Tarjeta>
    </div>
  )
}
