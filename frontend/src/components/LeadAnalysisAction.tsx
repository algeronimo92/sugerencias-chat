import { useEffect } from 'react'
import { AlertTriangle, CheckCircle2, ScanSearch } from 'lucide-react'
import { useLeadStageCatalog } from '../hooks/useLeadStages'
import { SuggestionError, useAnalyzeLead } from '../hooks/useSuggestions'
import { Button } from './ui/Button'

interface Props {
  chatId: string
}

/**
 * "Analizar con IA": el analista lee la conversación y actualiza la ficha del
 * lead. Solo corre cuando el vendedor lo pide (descuenta de la cuota del
 * negocio), nunca al recibir mensajes.
 */
export function LeadAnalysisAction({ chatId }: Props) {
  const analyze = useAnalyzeLead()
  const stages = useLeadStageCatalog()
  const { reset } = analyze
  // El resultado es de un lead puntual: al cambiar de chat no se arrastra.
  useEffect(() => reset(), [chatId, reset])

  const error = analyze.error
  const retryable = !(error instanceof SuggestionError) || error.retryable

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        size="sm"
        onClick={() => analyze.mutate(chatId)}
        disabled={analyze.isPending}
        title="La IA lee la conversación y actualiza la etapa y los datos del lead"
      >
        <ScanSearch className={`h-3.5 w-3.5 ${analyze.isPending ? 'animate-pulse text-wa-primary' : ''}`} aria-hidden="true" />
        {analyze.isPending ? 'Analizando…' : 'Analizar con IA'}
      </Button>

      <div aria-live="polite">
        {analyze.isPending && (
          <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Leyendo la conversación. Puede tardar hasta un minuto.</p>
        )}
        {analyze.isSuccess && (
          <p className="flex items-start gap-1.5 text-xs text-wa-primary-strong dark:text-wa-primary">
            <CheckCircle2 className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {analyze.data?.changed === false
              ? 'Sin cambios: la ficha ya refleja la conversación.'
              : analyze.data?.stage
                ? `Ficha actualizada. Etapa: ${stages.label(analyze.data.stage)}.`
                : 'Ficha actualizada.'}
          </p>
        )}
        {error && (
          <p role={retryable ? 'alert' : 'status'} className={`flex items-start gap-1.5 text-xs ${retryable ? 'text-red-600 dark:text-red-400' : 'text-amber-800 dark:text-amber-200'}`}>
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            {error.message}
          </p>
        )}
      </div>
    </div>
  )
}
