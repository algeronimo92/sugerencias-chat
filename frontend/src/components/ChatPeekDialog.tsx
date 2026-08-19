import { useEffect, useMemo, useRef } from 'react'
import { EyeOff, Loader2, MessageCircle, X } from 'lucide-react'
import type { Chat, Message } from '../types'
import { useMessages } from '../hooks/useMessages'
import { avatarInitial, displayName } from '../utils/chat'
import { formatMessageTime, parseContent, resolveMediaUrl } from '../utils/message'
import {
  DialogPrimitive as Dialog,
  dialogContentPositionClassElevated,
  dialogOverlayClassElevated,
} from './ui/Dialog'

const MESSAGE_LIMIT = 12

function PeekMessage({ message }: { message: Message }) {
  const isOwn = message.sender === 'vendedor'
  const parsed = parseContent(message)
  const Icon = parsed.icon
  const imageUrl = parsed.kind === 'image' ? resolveMediaUrl(message.media_url) : null
  const text = message.deleted_at
    ? 'Se eliminó este mensaje'
    : parsed.text || (parsed.kind !== 'text' ? parsed.label : 'Mensaje vacío')

  return (
    <div className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[86%] rounded-xl px-3 py-2 text-sm shadow-sm ${
          isOwn
            ? 'rounded-tr-sm bg-[#d9fdd3] text-[#111b21] dark:bg-[#005c4b] dark:text-[#e9edef]'
            : 'rounded-tl-sm bg-white text-[#111b21] dark:bg-[#202c33] dark:text-[#e9edef]'
        }`}
      >
        {imageUrl && (
          <img
            src={imageUrl}
            alt={parsed.text || 'Imagen del chat'}
            className="mb-1.5 max-h-40 w-full rounded-lg object-cover"
          />
        )}
        <div className="flex items-start gap-1.5">
          {Icon && !imageUrl && <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 opacity-70" />}
          <p className={message.deleted_at ? 'italic opacity-70' : 'whitespace-pre-wrap break-words'}>{text}</p>
        </div>
        <span className="mt-1 block text-right text-[10px] opacity-60">{formatMessageTime(message.sent_at)}</span>
      </div>
    </div>
  )
}

/**
 * Vista rápida estilo iOS. Consulta los mensajes, pero no navega al chat ni
 * llama al endpoint `/read`; solo `onOpen` entra a la conversación normal.
 */
export function ChatPeekDialog({
  chat,
  onClose,
  onOpen,
}: {
  chat: Chat
  onClose: () => void
  onOpen: () => void
}) {
  const { data, isLoading, error } = useMessages(chat.chat_id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const messages = useMemo(
    () => [...(data?.pages ?? [])].reverse().flatMap(page => page.items).slice(-MESSAGE_LIMIT),
    [data],
  )

  useEffect(() => {
    const container = scrollRef.current
    if (container) container.scrollTop = container.scrollHeight
  }, [messages])

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${dialogOverlayClassElevated} bg-black/55 backdrop-blur-sm`} />
        <Dialog.Content
          aria-describedby={undefined}
          className={`${dialogContentPositionClassElevated} flex h-[min(78dvh,42rem)] w-[calc(100%-1.5rem)] max-w-md flex-col overflow-hidden rounded-3xl border border-white/20 bg-wa-chat shadow-2xl dark:border-wa-border-dark dark:bg-wa-chat-dark`}
        >
          <header className="shrink-0 border-b border-wa-border bg-white px-4 py-3 dark:border-wa-border-dark dark:bg-wa-head-dark">
            <div className="flex items-center gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-wa-primary to-wa-primary-strong text-sm font-semibold text-white">
                {avatarInitial(chat)}
              </span>
              <div className="min-w-0 flex-1">
                <Dialog.Title className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                  {displayName(chat)}
                </Dialog.Title>
                <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">{chat.phone || 'Sin teléfono'}</p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Cerrar vista rápida"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-wa-muted transition-colors hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="mt-2 flex items-center justify-center gap-1.5 rounded-full bg-wa-primary/10 px-3 py-1 text-[11px] font-medium text-wa-primary-strong dark:text-wa-primary">
              <EyeOff className="h-3.5 w-3.5" />
              Vista rápida · no se marcará como leído
            </div>
          </header>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto px-3 py-4 sm:px-4">
            {isLoading && (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-wa-muted dark:text-wa-muted-dark">
                <Loader2 className="h-5 w-5 animate-spin" /> Cargando conversación…
              </div>
            )}
            {error && (
              <div role="alert" className="flex h-full items-center justify-center px-6 text-center text-sm text-red-500">
                No se pudo cargar la vista rápida.
              </div>
            )}
            {!isLoading && !error && messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-wa-muted dark:text-wa-muted-dark">
                <MessageCircle className="h-9 w-9 opacity-60" />
                <p className="text-sm">Todavía no hay mensajes.</p>
              </div>
            )}
            {!isLoading && !error && messages.map(message => <PeekMessage key={message.id} message={message} />)}
          </div>

          <footer className="flex shrink-0 items-center gap-2 border-t border-wa-border bg-white p-3 dark:border-wa-border-dark dark:bg-wa-head-dark">
            <button
              type="button"
              onClick={onClose}
              className="h-10 flex-1 rounded-xl border border-wa-border text-sm font-medium text-wa-muted transition-colors hover:bg-wa-hover dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={onOpen}
              className="h-10 flex-1 rounded-xl bg-wa-primary text-sm font-semibold text-white transition-colors hover:bg-wa-primary-strong"
            >
              Abrir chat
            </button>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
