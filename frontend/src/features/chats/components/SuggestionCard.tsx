import { Check, ChevronDown, ChevronUp, MessageSquare, Mic, PenLine, Video } from 'lucide-react'
import { useState } from 'react'
import type { Sugerencia } from '../../ai/types'
import { useChatDraft } from '../draftStore'
import { AudioSuggestionDialog } from './AudioSuggestionDialog'

const CANAL_ICON = {
  texto: MessageSquare,
  audio: Mic,
  video: Video,
} as const

interface Props {
  sugerencia: Sugerencia
  index: number
  chatId: string
  /** Después de llevar el texto al compositor (fuera de escritorio el panel
   *  tapa el chat y hay que cerrarlo para verlo). */
  onUse?: () => void
}

/**
 * El texto sugerido va al compositor con «Usar», no al portapapeles: en el
 * celular «Copiar» obligaba a cerrar el panel, tocar el campo y pegar, y en
 * escritorio nadie sabía si había copiado. Si ya había un borrador se agrega
 * debajo, igual que una plantilla, para no pisar lo que se estaba escribiendo.
 */
export function SuggestionCard({ sugerencia, index, chatId, onUse }: Props) {
  const [used, setUsed] = useState(false)
  const [showMotivo, setShowMotivo] = useState(false)
  const [isAudioDialogOpen, setIsAudioDialogOpen] = useState(false)
  const [, setDraft] = useChatDraft(chatId)

  const CanalIcon = CANAL_ICON[sugerencia.canal as keyof typeof CANAL_ICON] ?? MessageSquare

  function handleUse() {
    const text = sugerencia.texto
    if (!text) return
    setDraft(current => current ? `${current}${/\s$/.test(current) ? '' : '\n'}${text}` : text)
    setUsed(true)
    setTimeout(() => setUsed(false), 2000)
    onUse?.()
  }

  return (
    <div className="bg-white dark:bg-wa-head-dark rounded-xl border border-wa-primary/30 dark:border-wa-primary/25 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-wa-primary/5 dark:bg-wa-primary/10 border-b border-wa-primary/15 dark:border-wa-primary/20">
        <div className="flex items-center gap-2 min-w-0">
          <CanalIcon className="w-4 h-4 text-wa-primary" />
          <span className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide">
            Opción {index + 1}
          </span>
        </div>
        {sugerencia.texto && (
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button type="button"
              onClick={() => setIsAudioDialogOpen(true)}
              title="Editar texto y enviar como nota de voz"
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-wa-field dark:bg-wa-field-dark text-wa-muted dark:text-wa-muted-dark hover:bg-wa-border dark:hover:bg-wa-active-dark hover:text-wa-text dark:hover:text-wa-text-dark"
            >
              <Mic className="w-3.5 h-3.5" />
              Audio
            </button>
            <button type="button"
              onClick={handleUse}
              title="Llevar el texto al cuadro de escritura para revisarlo y enviarlo"
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                used
                  ? 'bg-wa-primary/15 text-wa-primary-strong dark:bg-wa-primary/25 dark:text-wa-primary'
                  : 'bg-wa-primary text-white hover:bg-wa-primary-strong'
              }`}
            >
              {used ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <PenLine className="w-3.5 h-3.5" aria-hidden="true" />}
              {used ? 'En el cuadro' : 'Usar'}
            </button>
          </div>
        )}
      </div>

      <div className="p-3 space-y-2">
        {/* Táctica */}
        <p className="text-xs font-semibold text-wa-primary-strong dark:text-wa-primary uppercase tracking-wide">
          {sugerencia.tactica}
        </p>

        {/* Texto sugerido — previsualizado como la burbuja saliente que sería */}
        {sugerencia.texto && (
          <p className="text-sm text-wa-text dark:text-wa-text-dark leading-relaxed bg-wa-out dark:bg-wa-out-dark rounded-bubble rounded-tr-none p-3 shadow-sm whitespace-pre-wrap">
            {sugerencia.texto}
          </p>
        )}

        {/* Adjuntos */}
        {sugerencia.adjuntos.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">Adjuntos:</p>
            {sugerencia.adjuntos.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-wa-primary-strong dark:text-wa-accent hover:underline truncate"
              >
                {url}
              </a>
            ))}
            {/* El modelo explica por qué los eligió; antes se pedía y no se mostraba. */}
            {sugerencia.motivo_adjuntos && (
              <p className="text-xs text-wa-muted dark:text-wa-muted-dark">{sugerencia.motivo_adjuntos}</p>
            )}
          </div>
        )}

        {/* Por qué — expandible */}
        <button type="button"
          onClick={() => setShowMotivo(!showMotivo)}
          className="text-xs text-wa-muted dark:text-wa-muted-dark hover:text-wa-text dark:hover:text-wa-text-dark flex items-center gap-1 transition-colors"
        >
          {showMotivo ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>¿Por qué esta táctica?</span>
        </button>
        {showMotivo && (
          <p className="text-xs text-wa-muted dark:text-wa-muted-dark italic border-l-2 border-wa-border dark:border-wa-border-dark pl-3">
            {sugerencia.porque}
          </p>
        )}
      </div>

      {isAudioDialogOpen && (
        <AudioSuggestionDialog
          chatId={chatId}
          initialText={sugerencia.texto ?? ''}
          onClose={() => setIsAudioDialogOpen(false)}
        />
      )}
    </div>
  )
}
