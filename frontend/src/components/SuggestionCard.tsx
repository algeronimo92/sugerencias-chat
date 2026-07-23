import { useState } from 'react'
import { MessageSquare, Mic, Video, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react'
import type { Sugerencia } from '../types'
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
}

export function SuggestionCard({ sugerencia, index, chatId }: Props) {
  const [copied, setCopied] = useState(false)
  const [showMotivo, setShowMotivo] = useState(false)
  const [isAudioDialogOpen, setIsAudioDialogOpen] = useState(false)

  const valueToCopy = sugerencia.texto ?? ''
  const CanalIcon = CANAL_ICON[sugerencia.canal as keyof typeof CANAL_ICON] ?? MessageSquare

  async function handleCopy() {
    if (!valueToCopy) return
    await navigator.clipboard.writeText(valueToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white dark:bg-wa-head-dark rounded-xl border border-wa-primary/30 dark:border-wa-primary/25 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 bg-wa-primary/5 dark:bg-wa-primary/10 border-b border-wa-primary/15 dark:border-wa-primary/20">
        <div className="flex items-center gap-2 min-w-0">
          <CanalIcon className="w-4 h-4 text-wa-primary" />
          <span className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide">
            Opción {index + 1}
          </span>
        </div>
        {sugerencia.texto && (
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              onClick={() => setIsAudioDialogOpen(true)}
              title="Editar texto y enviar como nota de voz"
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-wa-field dark:bg-wa-field-dark text-wa-muted dark:text-wa-muted-dark hover:bg-wa-border dark:hover:bg-wa-active-dark hover:text-wa-text dark:hover:text-wa-text-dark"
            >
              <Mic className="w-3.5 h-3.5" />
              Audio
            </button>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-semibold transition-colors ${
                copied
                  ? 'bg-wa-primary/15 text-wa-primary-strong dark:bg-wa-primary/25 dark:text-wa-primary'
                  : 'bg-wa-primary text-white hover:bg-wa-primary-strong'
              }`}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
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
          </div>
        )}

        {/* Por qué — expandible */}
        <button
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
