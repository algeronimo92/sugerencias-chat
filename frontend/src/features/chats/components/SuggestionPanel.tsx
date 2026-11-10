import { AlertTriangle, ChevronDown, LockKeyhole, MessageSquareDot, Sparkles, TrendingUp } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useCustomerServiceWindow } from '../hooks/useCustomerServiceWindow'
import { Badge } from '../../../shared/ui/Badge'
import { Button } from '../../../shared/ui/Button'
import { ScheduledMessageCard } from './ScheduledMessageCard'
import { formatDayLabel, formatMessageTime } from '../../whatsapp/public/message'
import type { SuggestionResponse, SuggestionUnavailable } from '../../ai/types'
import type { Chat } from '../../leads/types'
import { LeadActivityPanel } from '../../leads/public/LeadActivityPanel'
import { LeadInfo } from '../../leads/public/LeadInfo'
import { LeadTagsPanel } from '../../leads/public/LeadTagsPanel'
import { LeadTaskCard } from '../../tasks/public/LeadTaskCard'
import { LeadAnalysisAction } from '../../ai/public/LeadAnalysisAction'
import { LeadAppointmentAction } from '../../appointments/public/LeadAppointmentAction'
import { useLeadPanelTab } from '../hooks/useLeadPanelTab'
import { LeadPanelTabs } from './LeadPanelTabs'
import { SuggestionCard } from './SuggestionCard'
import { SuggestionInstructionBox } from '../../ai/public/SuggestionInstructionBox'
import { Link } from 'react-router-dom'

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
  /** Falso cuando reintentar no sirve (plan sin IA, cuota agotada, asistente
   * sin configurar): el aviso explica el motivo y no ofrece "Reintentar". */
  errorRetryable?: boolean
  /** Código del error de generación (p. ej. `ai_key_missing`). */
  errorCode?: string | null
  /** El negocio no tiene sugerencias (sin clave de IA, plan sin IA…): en vez
   * de la sugerencia guardada se explica qué falta. */
  unavailable?: SuggestionUnavailable | null
  /** Solo un admin carga la clave; a los demás se les dice a quién pedírsela. */
  canConnect?: boolean
  /** Genera sugerencias a demanda; `force` pide otras ignorando lo guardado.
   * `instruction` es la indicación opcional del asesor para orientar a la IA. */
  onGenerate: (force?: boolean, instruction?: string) => void
  /** El vendedor llevó una sugerencia al compositor (fuera de escritorio el
   * panel tapa el chat: quien lo monta lo cierra). */
  onUse?: () => void
}

/**
 * Ficha del lead y copiloto IA en dos pestañas. Antes eran un solo scroll con
 * el copiloto arriba: "Agendar cita" quedaba cuarto y había que buscarlo, y el
 * botón que abría el panel era un ícono de IA. La ficha abre con "Separar
 * cita", que es la venta del negocio.
 */
export function SuggestionPanel(props: Props) {
  const { chat } = props
  // Indicación opcional del asesor para la IA. Vive acá porque los tres CTA
  // de generación (vacío, stale, "Otras") deben compartirla. Persiste entre
  // regeneraciones del mismo lead y se descarta al cambiar de chat.
  const [instruction, setInstruction] = useState('')
  useEffect(() => setInstruction(''), [chat.chat_id])
  const [tab, setTab] = useLeadPanelTab()
  // Con la ventana de 24 h cerrada solo salen plantillas aprobadas: generar
  // texto libre gastaba IA en algo que no se podía enviar.
  const { data: customerWindow } = useCustomerServiceWindow(chat.chat_id)
  const windowClosed = customerWindow ? !customerWindow.is_open : false

  function generate(force: boolean) {
    props.onGenerate(force, instruction.trim() || undefined)
  }

  return (
    <div className="flex h-full flex-col bg-white dark:bg-wa-panel-dark">
      <LeadPanelTabs
        tab={tab}
        onChange={setTab}
        canRegenerate={tab === 'copiloto' && Boolean(props.data) && !props.unavailable && !windowClosed}
        isGenerating={props.isGenerating}
        onRegenerate={() => generate(true)}
      />

      <div
        role="tabpanel"
        id={`panel-lead-${tab}`}
        aria-labelledby={`tab-lead-${tab}`}
        className="flex-1 space-y-3 overflow-y-auto p-3"
      >
        {tab === 'copiloto' ? (
          <section id="copiloto-ia" aria-label="Sugerencias con IA" className="space-y-3">
            <CopilotBody {...props} instruction={instruction} onInstructionChange={setInstruction} onGenerate={generate} windowClosed={windowClosed} />
          </section>
        ) : (
          <div className="space-y-3">
            <LeadAppointmentAction chat={chat} />
            <LeadInfo chat={chat} />
            <LeadAnalysisAction chatId={chat.chat_id} />
            <LeadTaskCard chat={chat} />
            <ScheduledMessageCard chat={chat} />
            <LeadTagsPanel chat={chat} />
            <LeadActivityPanel chatId={chat.chat_id} />
          </div>
        )}
      </div>
    </div>
  )
}

type BodyProps = Omit<Props, 'onGenerate' | 'chat'> & {
  chat: Chat
  instruction: string
  onInstructionChange: (value: string) => void
  onGenerate: (force: boolean) => void
  windowClosed: boolean
}

function CopilotBody(props: BodyProps) {
  if (props.unavailable) {
    return <CopilotUnavailable reason={props.unavailable} canConnect={props.canConnect ?? false} />
  }
  if (props.isLoading && !props.data) return <CopilotSkeleton />
  return <CopilotContent {...props} />
}

function CopilotSkeleton() {
  return (
    <div className="space-y-2" aria-hidden="true">
      <div className="h-5 w-32 animate-pulse rounded-full bg-wa-hover dark:bg-wa-hover-dark" />
      <div className="h-20 animate-pulse rounded-xl bg-wa-hover dark:bg-wa-hover-dark" />
    </div>
  )
}

function GeneratingNotice() {
  return (
    <div className="flex items-center gap-3 rounded-xl bg-wa-hover/60 px-3 py-3 text-sm text-wa-muted dark:bg-wa-hover-dark/60 dark:text-wa-muted-dark">
      <div className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-wa-primary border-t-transparent" />
      <p>Analizando la conversación… puede tardar unos segundos.</p>
    </div>
  )
}

function GenerationError({ error, errorCode, canConnect, errorRetryable, data, isStale, onGenerate }: BodyProps & { error: string }) {
  return (
    <CopilotError
      message={error}
      code={errorCode ?? null}
      canConnect={canConnect ?? false}
      retryable={errorRetryable ?? true}
      onRetry={() => onGenerate(!!data && !isStale)}
    />
  )
}

function CopilotContent(props: BodyProps) {
  const { data, isGenerating, error } = props
  const idle = !isGenerating && !error
  return (
    <>
      {isGenerating && !data && <GeneratingNotice />}
      {error && !isGenerating && <GenerationError {...props} error={error} />}
      {!data && idle && <EmptyCopilot {...props} />}
      {data && <SuggestionResults {...props} data={data} />}
    </>
  )
}

/** Lo que el negocio resuelve solo (cargar su clave de IA) lleva directo a
 *  Integraciones; el resto se explica y nada más. */
function ConnectAiLink({ code, canConnect }: { code: string | null; canConnect: boolean }) {
  if (code !== 'ai_key_missing') return null
  return canConnect
    ? <>{' '}<Link to="/integraciones#ia-sugerencias" className="font-semibold underline">Conectar en Integraciones</Link></>
    : <span className="block text-amber-800/80 dark:text-amber-200/80">Pídele a un administrador que cargue la clave.</span>
}

/** El negocio no tiene sugerencias: se dice por qué en lugar de mostrar una
 *  sugerencia vieja (las que n8n dejó guardadas antes del corte). */
function CopilotUnavailable({ reason, canConnect }: { reason: SuggestionUnavailable; canConnect: boolean }) {
  return (
    <div role="status" className="flex gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>
        {reason.message}
        <ConnectAiLink code={reason.code} canConnect={canConnect} />
      </p>
    </div>
  )
}

function CopilotError({ message, code, canConnect, retryable, onRetry }: {
  message: string
  code: string | null
  canConnect: boolean
  retryable: boolean
  onRetry: () => void
}) {
  if (!retryable) {
    // No es una falla pasajera: tono de aviso, sin "Reintentar" porque daría
    // el mismo resultado.
    return (
      <div role="status" className="flex gap-2 rounded-xl border border-amber-300/60 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-800/60 dark:bg-amber-950/30 dark:text-amber-200">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <p>
          {message}
          <ConnectAiLink code={code} canConnect={canConnect} />
        </p>
      </div>
    )
  }
  return (
    <div role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
      <p className="min-w-0 flex-1">{message}</p>
      <Button variant="secondary" size="sm" onClick={onRetry}>Reintentar</Button>
    </div>
  )
}

/** Sin sugerencias todavía: una tarjeta chica que invita a generarlas, sin
 *  gastar IA de entrada ni empujar la ficha del lead hacia abajo. */
function EmptyCopilot({ instruction, onInstructionChange, onGenerate, windowClosed }: BodyProps) {
  if (windowClosed) return <WindowClosedNotice />
  return (
    <div className="space-y-2.5 rounded-xl border border-wa-border px-3 py-3 dark:border-wa-border-dark">
      <p className="text-sm text-wa-muted dark:text-wa-muted-dark">
        La IA analiza la conversación y te propone respuestas para este lead.
      </p>
      <SuggestionInstructionBox value={instruction} onChange={onInstructionChange} />
      <Button size="sm" className="w-full" onClick={() => onGenerate(false)}>
        <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
        Genera sugerencias
      </Button>
    </div>
  )
}

/** Sin ventana de 24 h abierta no se puede mandar texto libre: se dice qué
 *  hacer en vez de ofrecer sugerencias que no se podrían enviar. */
function WindowClosedNotice() {
  return (
    <div role="status" className="flex gap-2 rounded-xl border border-wa-border px-3 py-2.5 text-sm text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
      <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p>Sin ventana de 24 h abierta solo puedes enviar una plantilla aprobada. Las sugerencias vuelven cuando el cliente escriba.</p>
    </div>
  )
}

function SuggestionResults({ chat, data, generatedAt, isStale, isGenerating, instruction, onInstructionChange, onGenerate, onUse, windowClosed }: BodyProps & { data: SuggestionResponse }) {
  const generatedLabel = generatedAt
    ? `${formatDayLabel(generatedAt).toLowerCase()} a las ${formatMessageTime(generatedAt)}`
    : null
  return (
    <>
      {windowClosed ? <WindowClosedNotice /> : <SuggestionInstructionBox value={instruction} onChange={onInstructionChange} disabled={isGenerating} />}

      {/* Regeneración con datos en pantalla: aviso sutil, sin bloquear */}
      {isGenerating && (
        <div className="flex items-center gap-2 rounded-xl border border-wa-primary/20 bg-wa-primary/5 px-3 py-2 text-sm text-wa-primary-strong dark:bg-wa-primary/10 dark:text-wa-primary">
          <div className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-wa-primary border-t-transparent" />
          <p>Generando nuevas sugerencias…</p>
        </div>
      )}

      {/* Desactualizada: el cliente escribió después. Informativo, no error. */}
      {isStale && !isGenerating && (
        <div className="flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-800 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-300">
          <MessageSquareDot className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1">El cliente volvió a escribir después.</p>
          {!windowClosed && <Button variant="secondary" size="sm" onClick={() => onGenerate(false)}>Genera nuevas</Button>}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <Badge variant="neutral" className="px-2 py-0.5 text-[11px] capitalize">Confianza: {data.confianza}</Badge>
        {data.senal_compra && (
          <Badge variant="success" className="gap-1 px-2 py-0.5 text-[11px]">
            <TrendingUp className="h-3 w-3" aria-hidden="true" /> Señal de compra
          </Badge>
        )}
        {generatedLabel && <span className="ml-auto text-[11px] text-wa-muted/80 dark:text-wa-muted-dark/80">{generatedLabel}</span>}
      </div>

      {/* `tipo_objecion` ya no viene en la respuesta (el analista lo guarda en
          el lead): el aviso «Objeción» que había acá nunca se mostraba. */}
      {data.alerta && <Notice tone="red" label="Alerta" text={data.alerta} />}

      {/* El análisis es contexto, no acción: cerrado salvo que se pida. */}
      <details className="group rounded-xl border border-wa-border px-3 py-2 dark:border-wa-border-dark">
        <summary className="flex cursor-pointer list-none items-center gap-1 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
          <ChevronDown className="h-3.5 w-3.5 -rotate-90 transition-transform group-open:rotate-0" aria-hidden="true" />
          Análisis de la conversación
        </summary>
        <p className="mt-2 text-sm leading-relaxed text-wa-text dark:text-wa-text-dark">{data.analisis}</p>
      </details>

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-wa-primary-strong dark:text-wa-primary">
          Sugerencias de respuesta ({data.sugerencias.length})
        </h3>
        <div className="space-y-2.5">
          {data.sugerencias.map((s, i) => (
            <SuggestionCard key={i} sugerencia={s} index={i} chatId={chat.chat_id} onUse={onUse} />
          ))}
          {data.sugerencias.length === 0 && (
            <p className="py-3 text-center text-sm text-wa-muted dark:text-wa-muted-dark">
              No se generaron sugerencias para este chat. Prueba pedir otras.
            </p>
          )}
        </div>
      </div>
    </>
  )
}

const NOTICE_TONES = {
  red: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-400',
} as const

function Notice({ tone, label, text }: { tone: keyof typeof NOTICE_TONES; label: string; text: string }) {
  return (
    <div className={`flex items-start gap-2 rounded-xl border px-3 py-2 text-sm ${NOTICE_TONES[tone]}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <p><span className="font-semibold">{label}:</span> {text}</p>
    </div>
  )
}
