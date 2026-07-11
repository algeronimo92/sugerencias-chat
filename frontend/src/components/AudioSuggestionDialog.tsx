import { useState } from 'react'
import { Loader2, Mic, X } from 'lucide-react'
import { useSendAudio } from '../hooks/useMessages'
import { useGenerateSpeech } from '../hooks/useTts'
import { extractErrorMessage } from '../utils/errors'

interface Props {
  chatId: string
  initialText: string
  onClose: () => void
}

export function AudioSuggestionDialog({ chatId, initialText, onClose }: Props) {
  const [text, setText] = useState(initialText)
  const [audio, setAudio] = useState<{ contentType: string; dataBase64: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const { mutate: generateSpeech, isPending: isGenerating } = useGenerateSpeech()
  const { mutate: sendAudio, isPending: isSending } = useSendAudio(chatId)

  function handleTextChange(value: string) {
    setText(value)
    // El audio ya generado corresponde al texto anterior; si se edita, hay
    // que volver a generarlo antes de poder enviarlo.
    setAudio(null)
  }

  function handleGenerate() {
    const trimmed = text.trim()
    if (!trimmed) return
    setError(null)
    generateSpeech(trimmed, {
      onSuccess: (result) => setAudio({ contentType: result.contentType, dataBase64: result.dataBase64 }),
      onError: (err) => setError(extractErrorMessage(err)),
    })
  }

  function handleSend() {
    if (!audio) return
    sendAudio(audio, {
      onSuccess: onClose,
      onError: (err) => setError(extractErrorMessage(err)),
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-md bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Enviar como nota de voz</p>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">
              Texto a convertir en audio
            </label>
            <textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              rows={4}
              autoFocus
              className="w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent resize-none"
            />
            <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-1">
              Ajustá abreviaturas o números (ej. "min." → "minutos") para que se escuche natural.
            </p>
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

          {audio ? (
            <audio controls autoPlay src={`data:${audio.contentType};base64,${audio.dataBase64}`} className="w-full" />
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !text.trim()}
              className="w-full py-2 text-sm font-medium text-white bg-gray-600 hover:bg-gray-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              Generar audio
            </button>
          )}
        </div>

        <div className="flex border-t border-gray-100 dark:border-gray-800">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={!audio || isSending}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 border-l border-gray-100 dark:border-gray-800"
          >
            {isSending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Enviar audio
          </button>
        </div>
      </div>
    </div>
  )
}
