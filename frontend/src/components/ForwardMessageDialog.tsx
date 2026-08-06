import { useEffect, useState } from 'react'
import { Check, Forward, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { EMPTY_CHAT_FILTERS, type Chat } from '../types'
import { useInfiniteChats } from '../hooks/useChats'
import { useForwardMessages } from '../hooks/useMessages'
import { avatarInitial, displayName, displayPhone } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'

// Mismo tope que valida el backend: WhatsApp también limita a cuántos chats se
// puede reenviar de una vez, para que no se use como lista de difusión.
const MAX_TARGETS = 5

interface Props {
  /** Chat de origen de los mensajes. */
  chatId: string
  /** Mensajes a reenviar, en el orden en que están en el hilo. */
  messageIds: number[]
  onClose: () => void
  /** Se llama solo si el reenvío salió: cierra el modo selección del hilo. */
  onForwarded?: () => void
}

/** Selector de leads destino para reenviar mensajes, como la pantalla de
 * "Reenviar a..." de WhatsApp: se buscan leads, se tildan varios y se manda. */
export function ForwardMessageDialog({ chatId, messageIds, onClose, onForwarded }: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<Chat[]>([])
  const { mutate: forwardMessages, isPending } = useForwardMessages(chatId)

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteChats(debouncedSearch, EMPTY_CHAT_FILTERS)
  const chats = data?.pages.flatMap(page => page.items) ?? []

  function toggle(chat: Chat) {
    setSelected(current => {
      if (current.some(item => item.chat_id === chat.chat_id)) {
        return current.filter(item => item.chat_id !== chat.chat_id)
      }
      if (current.length >= MAX_TARGETS) {
        toast.error(`Podés reenviar hasta ${MAX_TARGETS} chats a la vez`)
        return current
      }
      return [...current, chat]
    })
  }

  function submit() {
    if (!selected.length || isPending) return
    forwardMessages(
      { messageIds, targetChatIds: selected.map(chat => chat.chat_id) },
      {
        onSuccess: result => {
          const destino = result.forwarded_chats === 1
            ? displayName(selected[0])
            : `${result.forwarded_chats} chats`
          toast.success(`Reenviado a ${destino}`, {
            description: result.skipped_messages > 0
              ? `${result.skipped_messages} mensaje(s) no se pudieron reenviar por su tipo`
              : undefined,
          })
          onForwarded?.()
          onClose()
        },
        onError: error => toast.error(extractErrorMessage(error)),
      },
    )
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !isPending) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={`${dialogContentPositionClass} flex h-[85vh] max-h-[42rem] w-[calc(100%-2rem)] max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-wa-panel-dark`}>
          <div className="flex items-center justify-between gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <div className="flex min-w-0 items-center gap-2">
              <Forward aria-hidden="true" className="h-5 w-5 shrink-0 text-wa-primary-strong dark:text-wa-primary" />
              <div className="min-w-0">
                <Dialog.Title className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                  Reenviar a...
                </Dialog.Title>
                <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                  {messageIds.length === 1 ? '1 mensaje' : `${messageIds.length} mensajes`}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={isPending}
              aria-label="Cerrar"
              className="rounded-md p-1.5 text-wa-muted hover:bg-wa-field disabled:opacity-50 dark:hover:bg-wa-head-dark"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="border-b border-wa-border p-3 dark:border-wa-border-dark">
            <div className="relative">
              <Search aria-hidden="true" className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" />
              <input
                type="text"
                autoFocus
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder="Buscar lead..."
                className="w-full rounded-full border border-transparent bg-wa-field py-2 pl-10 pr-3 text-sm text-wa-text outline-none placeholder:text-wa-muted focus:ring-2 focus:ring-wa-primary/60 dark:bg-wa-field-dark dark:text-wa-text-dark dark:placeholder:text-wa-muted-dark"
              />
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-12">
                <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin text-wa-muted" />
              </div>
            ) : chats.length === 0 ? (
              <p className="px-4 py-12 text-center text-sm text-wa-muted dark:text-wa-muted-dark">
                No se encontraron leads.
              </p>
            ) : (
              <ul>
                {chats.map(chat => {
                  const isSelected = selected.some(item => item.chat_id === chat.chat_id)
                  return (
                    <li key={chat.chat_id}>
                      <button
                        type="button"
                        onClick={() => toggle(chat)}
                        aria-pressed={isSelected}
                        className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-wa-hover dark:hover:bg-wa-hover-dark"
                      >
                        <div className="relative shrink-0">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-br from-wa-primary to-wa-primary-strong text-xs font-semibold text-white">
                            {avatarInitial(chat)}
                          </div>
                          {isSelected && (
                            <span className="absolute -bottom-0.5 -right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-wa-primary ring-2 ring-white dark:ring-wa-panel-dark">
                              <Check aria-hidden="true" className="h-2.5 w-2.5 text-white" />
                            </span>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">
                            {displayName(chat)}
                          </p>
                          <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">
                            {displayPhone(chat)}
                          </p>
                        </div>
                      </button>
                    </li>
                  )
                })}
                {hasNextPage && (
                  <li className="p-3">
                    <button
                      type="button"
                      onClick={() => { if (!isFetchingNextPage) void fetchNextPage() }}
                      disabled={isFetchingNextPage}
                      className="mx-auto flex items-center gap-2 rounded-full bg-wa-field px-3 py-1.5 text-xs font-medium text-wa-muted hover:bg-wa-hover disabled:cursor-wait dark:bg-wa-head-dark dark:text-wa-muted-dark"
                    >
                      {isFetchingNextPage && <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />}
                      {isFetchingNextPage ? 'Cargando...' : 'Cargar más leads'}
                    </button>
                  </li>
                )}
              </ul>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <p className="min-w-0 truncate text-xs text-wa-muted dark:text-wa-muted-dark">
              {selected.length === 0
                ? 'Elegí a quién reenviar'
                : selected.map(chat => displayName(chat)).join(', ')}
            </p>
            <Button
              onClick={submit}
              disabled={!selected.length || isPending}
              aria-busy={isPending}
              className="shrink-0"
            >
              {isPending
                ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                : <Forward aria-hidden="true" className="h-4 w-4" />}
              Reenviar{selected.length > 0 && ` (${selected.length})`}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
