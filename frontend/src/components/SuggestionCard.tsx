import { useState } from 'react'
import { MessageSquare, Mic, Video, Copy, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import type { Sugerencia } from '../types'
import { useSendAudio } from '../hooks/useMessages'
import { useGenerateSpeech } from '../hooks/useTts'
import { extractErrorMessage } from '../utils/errors'
import { AudioConfirmDialog } from './AudioConfirmDialog'

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
  const [pendingAudio, setPendingAudio] = useState<{ contentType: string; dataBase64: string } | null>(null)
  const [audioError, setAudioError] = useState<string | null>(null)

  const valueToCopy = sugerencia.texto ?? ''
  const CanalIcon = CANAL_ICON[sugerencia.canal as keyof typeof CANAL_ICON] ?? MessageSquare

  const { mutate: generateSpeech, isPending: isGenerating } = useGenerateSpeech()
  const { mutate: sendAudio, isPending: isSendingAudio } = useSendAudio(chatId)

  async function handleCopy() {
    if (!valueToCopy) return
    await navigator.clipboard.writeText(valueToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  function handleGenerateAudio() {
    if (!sugerencia.texto) return
    setAudioError(null)
    generateSpeech(sugerencia.texto, {
      onSuccess: (result) => setPendingAudio({ contentType: result.contentType, dataBase64: result.dataBase64 }),
      onError: (err) => setAudioError(extractErrorMessage(err)),
    })
  }

  function handleConfirmSendAudio() {
    if (!pendingAudio) return
    sendAudio(pendingAudio, {
      onSuccess: () => setPendingAudio(null),
      onError: (err) => setAudioError(extractErrorMessage(err)),
    })
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 bg-gray-50 dark:bg-gray-800/60 border-b border-gray-100 dark:border-gray-700">
        <div className="flex items-center gap-2 min-w-0">
          <CanalIcon className="w-4 h-4 text-green-600 dark:text-green-500" />
          <span className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            Opción {index + 1}
          </span>
        </div>
        {sugerencia.texto && (
          <div className="flex items-center gap-1.5 shrink-0 ml-2">
            <button
              onClick={handleGenerateAudio}
              disabled={isGenerating}
              title="Generar y enviar como nota de voz"
              className="flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              Audio
            </button>
            <button
              onClick={handleCopy}
              className={`flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg font-medium transition-colors ${
                copied
                  ? 'bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400'
                  : 'bg-green-600 text-white hover:bg-green-700'
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
        <p className="text-xs font-semibold text-green-600 dark:text-green-500 uppercase tracking-wide">
          {sugerencia.tactica}
        </p>

        {/* Texto sugerido */}
        {sugerencia.texto && (
          <p className="text-sm text-gray-800 dark:text-gray-200 leading-relaxed bg-green-50 dark:bg-green-950/30 border border-green-100 dark:border-green-900 rounded-lg p-3 whitespace-pre-wrap">
            {sugerencia.texto}
          </p>
        )}

        {/* Adjuntos */}
        {sugerencia.adjuntos.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500 dark:text-gray-400">Adjuntos:</p>
            {sugerencia.adjuntos.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-green-600 dark:text-green-500 hover:underline truncate"
              >
                {url}
              </a>
            ))}
          </div>
        )}

        {/* Por qué — expandible */}
        <button
          onClick={() => setShowMotivo(!showMotivo)}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300 flex items-center gap-1 transition-colors"
        >
          {showMotivo ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
          <span>¿Por qué esta táctica?</span>
        </button>
        {showMotivo && (
          <p className="text-xs text-gray-500 dark:text-gray-400 italic border-l-2 border-gray-200 dark:border-gray-700 pl-3">
            {sugerencia.porque}
          </p>
        )}

        {audioError && !pendingAudio && (
          <p className="text-xs text-red-500 dark:text-red-400">{audioError}</p>
        )}
      </div>

      {pendingAudio && (
        <AudioConfirmDialog
          audioSrc={`data:${pendingAudio.contentType};base64,${pendingAudio.dataBase64}`}
          isSending={isSendingAudio}
          error={audioError}
          onConfirm={handleConfirmSendAudio}
          onCancel={() => setPendingAudio(null)}
        />
      )}
    </div>
  )
}
