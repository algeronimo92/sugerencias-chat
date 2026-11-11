import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import type { Organization } from '../../../types'
import { StarterPackAction } from '../../StarterPackAction'
import { Tarjeta } from '../PanelUi'

function Dato({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">{etiqueta}</dt>
      <dd className="mt-0.5 break-all font-mono text-xs text-wa-text dark:text-wa-text-dark">{valor}</dd>
    </div>
  )
}

/** Lo que el operador necesita para diagnosticar el espacio del negocio: en
 *  qué revisión quedó su schema y dónde viven sus archivos. */
export function BusinessSystem({ organizacion }: { organizacion: Organization }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Tarjeta titulo="Espacio del negocio" descripcion="Cada negocio vive aislado en su propio esquema y su propia carpeta de archivos.">
        <p className={`mb-4 inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-semibold ${organizacion.up_to_date ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-red-500/10 text-red-700 dark:text-red-300'}`}>
          {organizacion.up_to_date
            ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
            : <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
          {organizacion.up_to_date ? 'Esquema al día' : 'Pendiente de actualización'}
        </p>
        <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          <Dato etiqueta="Esquema" valor={organizacion.schema_name} />
          {organizacion.storage_prefix && <Dato etiqueta="Almacenamiento" valor={`tenants/${organizacion.storage_prefix}/`} />}
          <Dato etiqueta="Revisión" valor={organizacion.revision ?? 'Desconocida'} />
          <Dato etiqueta="Migración" valor={organizacion.migration_status ?? 'Sin registro'} />
          <Dato etiqueta="Identificador" valor={organizacion.id} />
          {organizacion.created_at && <Dato etiqueta="Alta" valor={new Date(organizacion.created_at).toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric' })} />}
        </dl>
      </Tarjeta>

      <Tarjeta
        titulo="Paquete inicial"
        descripcion="Etiquetas, plantillas con atajo y automatizaciones de ejemplo (desactivadas) de una clínica estética. Solo suma lo que falta; repetirlo no cambia nada."
      >
        <div className="flex justify-start [&>div]:items-start [&_p]:text-left">
          <StarterPackAction organizacion={organizacion} />
        </div>
      </Tarjeta>
    </div>
  )
}
