import { Sparkles, AlertTriangle, TrendingUp, MessageSquareDot } from 'lucide-react'
import type { Chat, SuggestionResponse } from '../types'
import { LeadInfo } from './LeadInfo'
import { SuggestionCard } from './SuggestionCard'
import { LeadActivityPanel } from './LeadActivityPanel'
import { LeadTagsPanel } from './LeadTagsPanel'
import { LeadTaskCard } from './LeadTaskCard'
import { ScheduledMessageCard } from './ScheduledMessageCard'
import { formatDayLabel, formatMessageTime } from '../utils/message'
import { Badge, Button, Card } from './ui'

interface Props {
  chat: Chat
  /** Sugerencia guardada del lead (o null si todavía no se generó ninguna). */
  data: SuggestionResponse | null
  /** Momento en que se generó la sugerencia mostrada. */
  generatedAt: string | null
  /** El cliente escribió después de generarse: se muestra igual, con aviso. */
  isStale: boolean
  /** Lectura inicial del estado guardado (barata, sin IA). */
  isLoading: boolean
  /** Generación con IA en curso — siempre iniciada por el vendedor. */
  isGenerating: boolean
  error: string | null
  /** Genera sugerencias a demanda; `force` pide otras ignorando lo guardado. */
  onGenerate: (force?: boolean) => void
}

export function SuggestionPanel({
  chat,
  data,
  generatedAt,
  isStale,
  isLoading,
  isGenerating,
  error,
  onGenerate,
}: Props) {
  const generatedLabel = generatedAt
    ? `${formatDayLabel(generatedAt).toLowerCase()} a las ${formatMessageTime(generatedAt)}`
    : null

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex h-16 shrink-0 items-center gap-2 border-b border-wa-border bg-wa-head px-4 py-2.5 dark:border-wa-border-dark dark:bg-wa-head-dark">
        <Sparkles className="w-4 h-4 text-wa-primary" />
        <p className="text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-text-dark/80">
          Sugerencias IA
        </p>
        {/* "Generá otras" solo tiene sentido con sugerencias ya generadas. */}
        {data && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onGenerate(true)}
            disabled={isGenerating}
            title="Generar un juego nuevo de sugerencias"
            className="ml-auto"
          >
            <Sparkles
              className={`w-3.5 h-3.5 ${isGenerating ? 'animate-pulse text-wa-primary' : ''}`}
              aria-hidden="true"
            />
            Generá otras
          </Button>
        )}
      </div>

      {/* Content — primero la IA (protagonista), después la ficha CRM */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Lectura inicial del estado guardado: skeleton breve, sin spinner grande */}
        {isLoading && !data && (
          <div className="space-y-3" aria-hidden="true">
            <div className="h-6 w-40 rounded-full bg-wa-hover dark:bg-wa-hover-dark animate-pulse" />
            <div className="h-24 rounded-xl bg-wa-hover dark:bg-wa-hover-dark animate-pulse" />
            <div className="h-40 rounded-xl bg-wa-hover dark:bg-wa-hover-dark animate-pulse" />
          </div>
        )}

        {/* Generación desde cero: estado de progreso protagonista */}
        {isGenerating && !data && (
          <div className="flex flex-col items-center justify-center py-12 gap-3 text-wa-muted dark:text-wa-muted-dark">
            <div className="w-8 h-8 border-2 border-wa-primary border-t-transparent rounded-full animate-spin" />
            <p className="text-sm">Analizando la conversación…</p>
            <p className="text-xs text-wa-muted/80 dark:text-wa-muted-dark/80">Puede tardar unos segundos</p>
          </div>
        )}

        {error && !isGenerating && (
          <div className="bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-xl p-4 text-sm text-red-700 dark:text-red-400 space-y-3">
            <p>{error}</p>
            <Button variant="secondary" size="sm" onClick={() => onGenerate(!!data && !isStale)}>
              Reintentar
            </Button>
          </div>
        )}

        {/* Estado vacío: invita a generar a demanda, sin gastar IA de entrada */}
        {!data && !isLoading && !isGenerating && !error && (
          <div className="flex flex-col items-center justify-center py-14 px-6 text-center gap-1">
            <div className="w-14 h-14 rounded-full bg-wa-primary/10 dark:bg-wa-primary/15 flex items-center justify-center mb-2">
              <Sparkles className="w-6 h-6 text-wa-primary" />
            </div>
            <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Sugerencias con IA</p>
            <p className="text-sm text-wa-muted dark:text-wa-muted-dark max-w-60 leading-relaxed">
              Cuando lo necesites, la IA analiza la conversación y te propone respuestas para este lead.
            </p>
            <Button className="mt-4" onClick={() => onGenerate(false)}>
              <Sparkles className="w-4 h-4" aria-hidden="true" />
              Generá sugerencias
            </Button>
            <p className="text-xs text-wa-muted/80 dark:text-wa-muted-dark/80 mt-2">Tarda unos segundos</p>
          </div>
        )}

        {data && (
          <>
            {/* Regeneración con datos en pantalla: aviso sutil, sin bloquear */}
            {isGenerating && (
              <div className="flex items-center gap-2 bg-wa-primary/5 dark:bg-wa-primary/10 border border-wa-primary/20 rounded-xl px-4 py-2.5 text-sm text-wa-primary-strong dark:text-wa-primary">
                <div className="w-4 h-4 border-2 border-wa-primary border-t-transparent rounded-full animate-spin shrink-0" />
                <p>Generando nuevas sugerencias…</p>
              </div>
            )}

            {/* Desactualizada: el cliente escribió después. Informativo (azul),
              no error — la sugerencia sigue visible y regenerar es opcional. */}
            {isStale && !isGenerating && (
              <div className="flex items-start gap-2 bg-sky-50 dark:bg-sky-950/30 border border-sky-200 dark:border-sky-900 rounded-xl px-4 py-2.5 text-sm text-sky-800 dark:text-sky-300">
                <MessageSquareDot className="w-4 h-4 mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p>
                    <span className="font-semibold">El cliente volvió a escribir.</span> Estas sugerencias no tienen en
                    cuenta sus últimos mensajes.
                  </p>
                  <Button variant="secondary" size="sm" className="mt-2" onClick={() => onGenerate(false)}>
                    <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
                    Generá nuevas
                  </Button>
                </div>
              </div>
            )}

            {/* El estado se muestra en LeadInfo desde la DB. */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="neutral" className="px-3 py-1 text-xs capitalize">
                Confianza: {data.confianza}
              </Badge>
              {data.senal_compra && (
                <Badge variant="success" className="gap-1 px-3 py-1 text-xs">
                  <TrendingUp className="w-3 h-3" /> Señal de compra
                </Badge>
              )}
              {generatedLabel && (
                <span className="ml-auto text-[11px] text-wa-muted/80 dark:text-wa-muted-dark/80">
                  Generadas {generatedLabel}
                </span>
              )}
            </div>

            {/* Objeción detectada */}
            {data.tipo_objecion && (
              <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-xl px-4 py-2.5 text-sm text-amber-800 dark:text-amber-400">
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
            <Card className="p-4">
              <h3 className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide mb-2">
                Análisis de la conversación
              </h3>
              <p className="text-sm text-wa-text dark:text-wa-text-dark leading-relaxed">{data.analisis}</p>
            </Card>

            {/* Sugerencias — las protagonistas del panel */}
            <div>
              <h3 className="text-xs font-semibold text-wa-primary-strong dark:text-wa-primary uppercase tracking-wide mb-3">
                Sugerencias de respuesta ({data.sugerencias.length})
              </h3>
              <div className="space-y-3">
                {data.sugerencias.map((s, i) => (
                  <SuggestionCard key={i} sugerencia={s} index={i} chatId={chat.chat_id} />
                ))}
                {data.sugerencias.length === 0 && (
                  <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center py-4">
                    No se generaron sugerencias para este chat. Probá pedir otras.
                  </p>
                )}
              </div>
            </div>
          </>
        )}

        {/* Ficha CRM del lead — siempre visible, en segundo plano visual */}
        <div className="pt-1">
          <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-wa-muted/80 dark:text-wa-muted-dark/80">
            Ficha del lead
          </h3>
          <div className="space-y-3">
            <LeadInfo chat={chat} />
            <LeadTaskCard chat={chat} />
            <ScheduledMessageCard chat={chat} />
            <LeadTagsPanel chat={chat} />
            <LeadActivityPanel chatId={chat.chat_id} />
          </div>
        </div>
      </div>
    </div>
  )
}
