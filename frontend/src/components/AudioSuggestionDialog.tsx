import { useState } from 'react'
import { Loader2, Mic, X } from 'lucide-react'
import { useSendAudio } from '../hooks/useMessages'
import { useGenerateSpeech } from '../hooks/useTts'
import { extractErrorMessage } from '../utils/errors'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui'
import { AudioPlayer } from './MediaPlayer'

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
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-wa-border dark:border-wa-border-dark">
          <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Enviar como nota de voz</Dialog.Title>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-wa-muted hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3">
          <div>
            <label className="block text-xs font-medium text-wa-muted dark:text-wa-muted-dark mb-1">
              Texto a convertir en audio
            </label>
            <textarea
              value={text}
              onChange={(e) => handleTextChange(e.target.value)}
              rows={4}
              autoFocus
              className="w-full text-sm bg-wa-hover dark:bg-wa-head-dark text-wa-text dark:text-wa-text-dark border border-wa-border dark:border-wa-border-dark rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 focus:border-transparent resize-none"
            />
            <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark mt-1">
              Ajustá abreviaturas o números (ej. "min." → "minutos") para que se escuche natural.
            </p>
          </div>

          {error && <p className="text-xs text-red-500 dark:text-red-400">{error}</p>}

          {audio ? (
            <AudioPlayer autoPlay src={`data:${audio.contentType};base64,${audio.dataBase64}`} className="w-full" ariaLabel="Vista previa de audio generado" />
          ) : (
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !text.trim()}
              className="w-full py-2 text-sm font-medium text-white bg-gray-600 hover:bg-wa-active-dark disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              {isGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
              Generar audio
            </button>
          )}
        </div>

        <div className="flex border-t border-wa-border dark:border-wa-border-dark">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-wa-hover dark:hover:bg-wa-head-dark transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSend}
            disabled={!audio || isSending}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-wa-primary hover:bg-wa-primary-strong disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 border-l border-wa-border dark:border-wa-border-dark"
          >
            {isSending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Enviar audio
          </button>
        </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
