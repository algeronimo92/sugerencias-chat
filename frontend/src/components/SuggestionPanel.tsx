import type { Chat, SuggestionResponse } from '../types'
import { LeadInfo } from './LeadInfo'
import { LeadStatus } from './LeadStatus'
import { SuggestionCard } from './SuggestionCard'

interface Props {
  chat: Chat
  data: SuggestionResponse | null
  isLoading: boolean
  error: string | null
}

export function SuggestionPanel({ chat, data, isLoading, error }: Props) {
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-gray-200 bg-white">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          Sugerencias IA
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Datos del lead (siempre visibles desde la DB) */}
        <LeadInfo chat={chat} />

        {isLoading && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-gray-400">
            <div className="w-8 h-8 border-2 border-green-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Consultando n8n...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-red-700 text-sm">
            {error}
          </div>
        )}

        {data && !isLoading && (
          <>
            {/* Estado + Confianza */}
            <LeadStatus estado={data.estado} confianza={data.confianza} />

            {/* Objeción detectada */}
            {data.tipo_objecion && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl px-4 py-2 text-sm text-yellow-800">
                <span className="font-semibold">Objeción detectada:</span> {data.tipo_objecion}
              </div>
            )}

            {/* Análisis */}
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Análisis de la conversación
              </h3>
              <p className="text-sm text-gray-700 leading-relaxed">{data.analisis}</p>
            </div>

            {/* Sugerencias */}
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Sugerencias de respuesta ({data.sugerencias.length})
              </h3>
              <div className="space-y-3">
                {data.sugerencias.map((s, i) => (
                  <SuggestionCard key={i} sugerencia={s} index={i} />
                ))}
                {data.sugerencias.length === 0 && (
                  <p className="text-sm text-gray-400 text-center py-4">
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
