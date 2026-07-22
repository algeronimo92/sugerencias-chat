import { Sparkles, AlertTriangle, RefreshCw, TrendingUp } from 'lucide-react'
import type { Chat, SuggestionResponse } from '../types'
import { LeadInfo } from './LeadInfo'
import { SuggestionCard } from './SuggestionCard'
import { LeadActivityPanel } from './LeadActivityPanel'
import { LeadTagsPanel } from './LeadTagsPanel'
import { LeadTaskCard } from './LeadTaskCard'
import { ScheduledMessageCard } from './ScheduledMessageCard'

interface Props {
  chat: Chat
  data: SuggestionResponse | null
  isLoading: boolean
  /** Revalidación en segundo plano con datos ya en pantalla: no bloquea la
   * vista, solo gira el icono del botón para avisar que se está actualizando. */
  isRefreshing?: boolean
  error: string | null
  /** Pide a n8n un juego nuevo de sugerencias, ignorando la caché del lead. */
  onRegenerate: () => void
}

export function SuggestionPanel({ chat, data, isLoading, isRefreshing = false, error, onRegenerate }: Props) {
  const busy = isLoading || isRefreshing
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3.5 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-green-600 dark:text-green-500" />
        <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Sugerencias IA
        </p>
        <button
          type="button"
          onClick={onRegenerate}
          disabled={busy}
          title="Pedir otras sugerencias a n8n"
          className="ml-auto inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-semibold text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${busy ? 'animate-spin' : ''}`} />
          Pedir otras
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Datos del lead (siempre visibles desde la DB) */}
        <LeadInfo chat={chat} />
        <LeadTaskCard chat={chat} />
        <ScheduledMessageCard chat={chat} />
        <LeadTagsPanel chat={chat} />
        <LeadActivityPanel chatId={chat.chat_id} />

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400 dark:text-gray-500">
            <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Consultando n8n...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-4 text-red-700 dark:text-red-400 text-sm">
            {error}
          </div>
        )}

        {data && !isLoading && (
          <>
            {/* El estado se muestra en LeadInfo desde la DB. */}
            <div className="flex items-center gap-2 flex-wrap">
              <span className="inline-block px-3 py-1 rounded-full text-xs font-semibold capitalize bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
                Confianza: {data.confianza}
              </span>
              {data.senal_compra && (
                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-full text-xs font-semibold bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-400">
                  <TrendingUp className="w-3 h-3" /> Señal de compra
                </span>
              )}
            </div>

            {/* Objeción detectada */}
            {data.tipo_objecion && (
              <div className="flex items-start gap-2 bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900 rounded-xl px-4 py-2.5 text-sm text-yellow-800 dark:text-yellow-400">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p><span className="font-semibold">Objeción detectada:</span> {data.tipo_objecion}</p>
              </div>
            )}

            {/* Alerta del agente */}
            {data.alerta && (
              <div className="flex items-start gap-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-xl px-4 py-2.5 text-sm text-red-700 dark:text-red-400">
                <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                <p><span className="font-semibold">Alerta:</span> {data.alerta}</p>
              </div>
            )}

            {/* Análisis */}
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
                Análisis de la conversación
              </h3>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{data.analisis}</p>
            </div>

            {/* Sugerencias */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Sugerencias de respuesta ({data.sugerencias.length})
              </h3>
              <div className="space-y-3">
                {data.sugerencias.map((s, i) => (
                  <SuggestionCard key={i} sugerencia={s} index={i} chatId={chat.chat_id} />
                ))}
                {data.sugerencias.length === 0 && (
                  <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-4">
                    n8n no devolvió sugerencias para este chat.
                  </p>
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
