import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { KeyRound, Loader2 } from 'lucide-react'
import { Button } from '../../../../../shared/ui/Button'
import { ConfirmDialog } from '../../../../../shared/ui/ConfirmDialog'
import { fetchOrganizationDbAccess, resetOrganizationDbAccess } from '../../../api'
import { platformKeys } from '../../../keys'
import type { Organization } from '../../../types'
import { DbCredentials } from '../DbCredentials'
import { mensajeDeError } from '../errors'
import { AvisoError, Tarjeta } from '../PanelUi'

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">{etiqueta}</dt>
      <dd className="mt-0.5 break-all font-mono text-xs text-wa-text dark:text-wa-text-dark">{valor}</dd>
    </div>
  )
}

/**
 * El login propio del negocio en PostgreSQL: administra todos los datos de su
 * schema (rol `cv_<id>_negocio`), sin poder cambiar la estructura de las
 * tablas ni ver otros negocios. Se crea al dar de alta el negocio; acá se ve
 * y se le genera una contraseña nueva.
 */
export function BusinessDatabase({ organizacion }: { organizacion: Organization }) {
  const queryClient = useQueryClient()
  const acceso = useQuery({
    queryKey: platformKeys.dbAccess(organizacion.id),
    queryFn: () => fetchOrganizationDbAccess(organizacion),
  })
  const regenerar = useMutation({
    mutationFn: () => resetOrganizationDbAccess(organizacion),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: platformKeys.dbAccess(organizacion.id) }),
  })
  const usuario = acceso.data?.user ?? null

  return (
    <Tarjeta
      titulo="Acceso directo a la base"
      descripcion="Un usuario de PostgreSQL propio del negocio: lee y modifica todos los datos de su esquema, sin cambiar la estructura de las tablas ni ver otros negocios."
    >
      {acceso.isLoading && <p className="text-sm text-wa-muted">Consultando la base…</p>}
      {acceso.isError && <AvisoError mensaje={mensajeDeError(acceso.error)} />}
      {acceso.data && (
        <dl className="mb-4 grid gap-x-6 gap-y-3 sm:grid-cols-3">
          <Dato etiqueta="Usuario" valor={usuario ?? 'Sin crear'} />
          <Dato etiqueta="Base" valor={acceso.data.database} />
          <Dato etiqueta="Esquema" valor={acceso.data.schema} />
        </dl>
      )}

      {regenerar.data && <div className="mb-4"><DbCredentials credenciales={regenerar.data} /></div>}
      {regenerar.isError && <div className="mb-4"><AvisoError mensaje={mensajeDeError(regenerar.error)} /></div>}

      {acceso.data && (usuario ? (
        <ConfirmDialog
          title="¿Generar una contraseña nueva?"
          description={`La contraseña actual de ${usuario} deja de funcionar en el momento. La nueva se muestra una sola vez.`}
          confirmLabel="Generar contraseña"
          confirmVariant="danger"
          disabled={regenerar.isPending}
          onConfirm={() => regenerar.mutate()}
        >
          <Button variant="secondary" disabled={regenerar.isPending}>
            {regenerar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
            Generar contraseña nueva
          </Button>
        </ConfirmDialog>
      ) : (
        <Button onClick={() => regenerar.mutate()} disabled={regenerar.isPending}>
          {regenerar.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound className="h-4 w-4" aria-hidden="true" />}
          Crear acceso
        </Button>
      ))}
    </Tarjeta>
  )
}
