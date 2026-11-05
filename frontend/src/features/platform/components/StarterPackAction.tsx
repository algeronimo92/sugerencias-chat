import { useMutation } from '@tanstack/react-query'
import { Loader2, PackagePlus } from 'lucide-react'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { applyStarterPack } from '../api'
import { describeStarterPackResult } from '../starterPack'
import type { Organization } from '../types'

/** Aplica a demanda el paquete "Clínica estética" a un negocio existente.
 *  El backend solo agrega lo que falta: no modifica nada de lo que el
 *  negocio ya cargó, y repetirlo no tiene efecto. */
export function StarterPackAction({ organizacion }: { organizacion: Organization }) {
  const aplicar = useMutation({ mutationFn: () => applyStarterPack(organizacion.id) })

  return (
    <div className="flex flex-col items-end gap-1">
      <ConfirmDialog
        title={`Paquete inicial para ${organizacion.name}`}
        description="Agrega las etiquetas, plantillas con atajo y automatizaciones de ejemplo (desactivadas) de una clínica estética. Solo suma lo que falta: no cambia nada de lo que el negocio ya cargó."
        confirmLabel="Aplicar paquete"
        onConfirm={() => aplicar.mutate()}
        disabled={aplicar.isPending}
      >
        <button
          type="button"
          disabled={aplicar.isPending}
          className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-wa-border px-3 text-sm font-semibold text-wa-muted transition hover:bg-wa-hover hover:text-wa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:cursor-wait disabled:opacity-50 dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark"
        >
          {aplicar.isPending
            ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            : <PackagePlus className="h-3.5 w-3.5" aria-hidden="true" />}
          Paquete inicial
        </button>
      </ConfirmDialog>
      {aplicar.isSuccess && (
        <p role="status" className="max-w-xs text-right text-xs text-wa-muted dark:text-wa-muted-dark">
          {describeStarterPackResult(aplicar.data)}
        </p>
      )}
      {aplicar.isError && (
        <p role="alert" className="max-w-xs text-right text-xs font-medium text-red-600 dark:text-red-300">
          {extractErrorMessage(aplicar.error)}
        </p>
      )}
    </div>
  )
}
