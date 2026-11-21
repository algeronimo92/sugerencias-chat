import { AlertTriangle, Check, Copy } from 'lucide-react'
import { useState } from 'react'
import { copyText } from '../../../../shared/utils/clipboard'
import type { CredencialesBase } from '../../types'

function CopyRow({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    if (await copyText(value)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <dt className="w-24 shrink-0 text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">{label}</dt>
      <dd className={`min-w-0 flex-1 break-all font-mono text-sm text-wa-text dark:text-wa-text-dark ${secret ? 'select-all' : ''}`}>{value}</dd>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={`Copiar ${label.toLowerCase()}`}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-wa-muted outline-none hover:bg-wa-hover focus-visible:ring-2 focus-visible:ring-wa-primary dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark"
      >
        {copied ? <Check className="h-4 w-4 text-wa-primary-strong" aria-hidden="true" /> : <Copy className="h-4 w-4" aria-hidden="true" />}
      </button>
    </div>
  )
}

/**
 * Las credenciales del login propio del negocio, tal como salen al crearlo o
 * al regenerar la contraseña. Es la única vez que se ven: la base guarda solo
 * su verificador SCRAM, así que no hay forma de volver a leerla.
 */
export function DbCredentials({ credenciales }: { credenciales: CredencialesBase }) {
  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-950/30">
      <p className="mb-3 flex items-start gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200" role="status">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        Guarda la contraseña ahora: no se vuelve a mostrar. Si se pierde, genera una nueva.
      </p>
      <dl className="space-y-1.5">
        <CopyRow label="Usuario" value={credenciales.user} />
        <CopyRow label="Contraseña" value={credenciales.password} secret />
        <CopyRow label="Base" value={credenciales.database} />
        <CopyRow label="Schema" value={credenciales.schema} />
      </dl>
    </div>
  )
}
