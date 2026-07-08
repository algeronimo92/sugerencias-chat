import { useEffect, useRef, useState } from 'react'
import axios from 'axios'
import { Loader2, Maximize2, RefreshCw, Send } from 'lucide-react'
import type { Chat } from '../types'
import { useMessages, useSendMessage } from '../hooks/useMessages'
import { avatarInitial, displayName } from '../utils/chat'
import { formatMessageTime, parseContent, parseRichText, resolveMediaUrl } from '../utils/message'
import { MediaLightbox } from './MediaLightbox'

function extractErrorMessage(err: unknown): string {
  if (axios.isAxiosError(err) && typeof err.response?.data?.detail === 'string') {
    return err.response.data.detail
  }
  return err instanceof Error ? err.message : 'Error desconocido'
}

interface Props {
  chat: Chat
  onRefreshSuggestions: () => void
}

interface OpenMedia {
  src: string
  kind: 'image' | 'video'
  alt: string
}

export function ChatThread({ chat, onRefreshSuggestions }: Props) {
  const { data: messages, isLoading, error, refetch, isFetching } = useMessages(chat.chat_id)
  const bottomRef = useRef<HTMLDivElement>(null)
  const [openMedia, setOpenMedia] = useState<OpenMedia | null>(null)

  const [draft, setDraft] = useState('')
  const { mutate: sendMessage, isPending: isSending, error: sendError } = useSendMessage(chat.chat_id)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  // El draft y el error de envío son por chat: al cambiar de lead no debe
  // quedar pegado el texto ni el error del chat anterior.
  useEffect(() => {
    setDraft('')
  }, [chat.chat_id])

  function handleSend(e: React.FormEvent) {
    e.preventDefault()
    const text = draft.trim()
    if (!text || isSending) return
    sendMessage(text, { onSuccess: () => setDraft('') })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend(e)
    }
  }

  function handleRefresh() {
    refetch()
    onRefreshSuggestions()
  }

  return (
    <div className="flex flex-col h-full bg-slate-50 dark:bg-gray-950">
      {/* Header */}
      <div className="px-4 py-3 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-green-500 to-green-600 flex items-center justify-center text-white font-semibold text-xs shrink-0">
            {avatarInitial(chat)}
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{displayName(chat)}</p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-500 font-medium transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          {isFetching ? 'Actualizando...' : 'Actualizar'}
        </button>
      </div>

      {/* Thread */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
        {isLoading && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Cargando mensajes...</p>
        )}
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">Error al cargar mensajes.</p>
        )}
        {!isLoading && !error && messages?.length === 0 && (
          <p className="text-sm text-gray-400 dark:text-gray-500 text-center py-8">Sin mensajes en este chat.</p>
        )}
        {messages?.map((m) => {
          const isVendedor = m.sender === 'vendedor'
          const { kind, icon: Icon, label, text } = parseContent(m.content)
          const mediaSrc = resolveMediaUrl(m.media_url)
          return (
            <div key={m.id} className={`flex ${isVendedor ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[75%] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm border ${
                  isVendedor
                    ? 'bg-green-100 dark:bg-green-950/50 border-green-200 dark:border-green-900 text-gray-800 dark:text-gray-100 rounded-tr-sm'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-100 rounded-tl-sm'
                }`}
              >
                {!mediaSrc && kind !== 'text' && Icon && (
                  <div className="inline-flex items-center gap-1 bg-black/5 dark:bg-white/10 rounded px-1.5 py-0.5 mb-1 text-[11px] font-medium text-gray-600 dark:text-gray-300 uppercase tracking-wide">
                    <Icon className="w-3 h-3" />
                    <span>{label}</span>
                  </div>
                )}
                {mediaSrc && kind === 'image' && (
                  <img
                    src={mediaSrc}
                    alt={text || 'Imagen'}
                    onClick={() => setOpenMedia({ src: mediaSrc, kind: 'image', alt: text || 'Imagen' })}
                    className="rounded-lg max-w-full max-h-80 object-contain mb-1.5 cursor-zoom-in"
                  />
                )}
                {mediaSrc && kind === 'video' && (
                  <div className="relative mb-1.5 inline-block">
                    <video controls src={mediaSrc} className="rounded-lg max-w-full max-h-80" />
                    <button
                      onClick={() => setOpenMedia({ src: mediaSrc, kind: 'video', alt: text || 'Video' })}
                      aria-label="Agrandar video"
                      className="absolute top-2 right-2 w-7 h-7 flex items-center justify-center rounded-md bg-black/50 text-white hover:bg-black/70 transition-colors"
                    >
                      <Maximize2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
                {mediaSrc && kind === 'audio' && (
                  <audio controls src={mediaSrc} className="max-w-full mb-1.5" />
                )}
                <p className={`whitespace-pre-wrap ${kind !== 'text' ? 'italic text-gray-600 dark:text-gray-400' : ''}`}>
                  {text ? (
                    parseRichText(text).map((segment, i) => {
                      switch (segment.type) {
                        case 'link':
                          return (
                            <a
                              key={i}
                              href={segment.text}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="underline text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 break-all not-italic"
                            >
                              {segment.text}
                            </a>
                          )
                        case 'bold':
                          return (
                            <strong key={i} className="font-semibold">
                              {segment.text}
                            </strong>
                          )
                        case 'italic':
                          return (
                            <em key={i} className="italic">
                              {segment.text}
                            </em>
                          )
                        case 'strike':
                          return (
                            <span key={i} className="line-through">
                              {segment.text}
                            </span>
                          )
                        case 'code':
                          return (
                            <code
                              key={i}
                              className="font-mono text-[0.85em] bg-black/10 dark:bg-white/15 rounded px-1 py-0.5 not-italic"
                            >
                              {segment.text}
                            </code>
                          )
                        default:
                          return <span key={i}>{segment.text}</span>
                      }
                    })
                  ) : (
                    <span className="italic text-gray-400 dark:text-gray-500">Sin contenido</span>
                  )}
                </p>
                <div className="text-[10px] text-gray-400 dark:text-gray-500 text-right mt-1">
                  {formatMessageTime(m.sent_at)}
                </div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      {/* Compose */}
      <form
        onSubmit={handleSend}
        className="border-t border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-3"
      >
        {sendError && (
          <p className="text-xs text-red-500 dark:text-red-400 mb-2">{extractErrorMessage(sendError)}</p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Escribí un mensaje..."
            rows={1}
            className="flex-1 resize-none text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500 max-h-32"
          />
          <button
            type="submit"
            disabled={isSending || !draft.trim()}
            aria-label="Enviar mensaje"
            className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>

      {openMedia && (
        <MediaLightbox
          src={openMedia.src}
          kind={openMedia.kind}
          alt={openMedia.alt}
          onClose={() => setOpenMedia(null)}
        />
      )}
    </div>
  )
}
