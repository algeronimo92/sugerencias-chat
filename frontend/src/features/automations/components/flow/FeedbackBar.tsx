import { AlertTriangle, CheckCircle2, LocateFixed } from 'lucide-react'

/**
 * La franja bajo la cabecera del editor: el error o el aviso de la última
 * acción. Si el error es de un bloque, lo nombra con su número del lienzo y
 * ofrece ir a él. Antes decía "Todos los bloques deben estar conectados
 * desde el disparador" sin decir cuál, y en un flujo de 50 bloques había que
 * buscarlo a ojo. Se anuncia a los lectores de pantalla (alert / status).
 */
export function FeedbackBar({ error, notice, blockNumber, onGoToBlock }: {
  error: string | null
  notice: string | null
  /** Número (#n) del bloque al que se refiere el error, si se refiere a uno. */
  blockNumber?: number
  onGoToBlock?: () => void
}) {
  if (error) {
    const aboutBlock = blockNumber != null && onGoToBlock
    return (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-red-100 px-4 py-2 text-xs text-red-800 dark:bg-red-950 dark:text-red-200">
        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <p className="min-w-0 flex-1">{aboutBlock ? <><strong>Bloque #{blockNumber}:</strong> {error}</> : error}</p>
        {aboutBlock && (
          <button type="button" onClick={onGoToBlock} className="inline-flex shrink-0 items-center gap-1 rounded-md border border-red-300 bg-white/70 px-2 py-1 font-semibold hover:bg-white dark:border-red-800 dark:bg-red-900/40 dark:hover:bg-red-900/70">
            <LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />Ver bloque #{blockNumber}
          </button>
        )}
      </div>
    )
  }
  if (!notice) return null
  return (
    <div role="status" className="flex items-center gap-2 bg-green-100 px-4 py-2 text-xs text-wa-primary-strong dark:bg-green-950 dark:text-green-300">
      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <p>{notice}</p>
    </div>
  )
}
