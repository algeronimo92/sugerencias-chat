import { useEffect, useState } from 'react'
import { GitMerge, Loader2, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { EMPTY_CHAT_FILTERS, type Chat } from '../types'
import { useInfiniteChats, useMergeLead } from '../hooks/useChats'
import { avatarInitial, displayName, displayPhone } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'

interface Props {
  /** Lead que se conserva: mantiene su etapa e identidad y recibe el
   * historial del que se elija acá. */
  chat: Chat
  onClose: () => void
  onMerged?: () => void
}

/** Busca un lead duplicado y lo fusiona dentro de `chat`. Irreversible: el
 * elegido pierde su ficha, así que hay que confirmarlo explícitamente antes
 * de mandar la fusión. */
export function MergeLeadDialog({ chat, onClose, onMerged }: Props) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<Chat | null>(null)
  const { mutate: mergeLead, isPending } = useMergeLead(chat.chat_id)

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteChats(debouncedSearch, EMPTY_CHAT_FILTERS)
  const chats = (data?.pages.flatMap(page => page.items) ?? []).filter(
    (item) => item.chat_id !== chat.chat_id
  )

  function submit() {
    if (!selected || isPending) return
    mergeLead(selected.chat_id, {
      onSuccess: () => {
        toast.success(`Se fusionó ${displayName(selected)} en ${displayName(chat)}`)
        onMerged?.()
        onClose()
      },
      onError: (error) => toast.error(extractErrorMessage(error)),
    })
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !isPending) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={`${dialogContentPositionClass} flex h-[85vh] max-h-[42rem] w-[calc(100%-2rem)] max-w-md flex-col overflow-hidden rounded-xl bg-white shadow-2xl dark:bg-wa-panel-dark`}>
          <div className="flex items-center justify-between gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <div className="flex min-w-0 items-center gap-2">
              <GitMerge aria-hidden="true" className="h-5 w-5 shrink-0 text-wa-primary-strong dark:text-wa-primary" />
              <div className="min-w-0">
                <Dialog.Title className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                  Fusionar con...
                </Dialog.Title>
                <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">
                  Se conserva {displayName(chat)}
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
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar el lead duplicado..."
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
                {chats.map((item) => {
                  const isSelected = selected?.chat_id === item.chat_id
                  return (
                    <li key={item.chat_id}>
                      <button
                        type="button"
                        onClick={() => setSelected(isSelected ? null : item)}
                        aria-pressed={isSelected}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors hover:bg-wa-hover dark:hover:bg-wa-hover-dark ${
                          isSelected ? 'bg-wa-primary/10 dark:bg-wa-primary/15' : ''
                        }`}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-wa-primary to-wa-primary-strong text-xs font-semibold text-white">
                          {avatarInitial(item)}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">
                            {displayName(item)}
                          </p>
                          <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">
                            {displayPhone(item)}
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

          <div className="border-t border-wa-border px-4 py-3 dark:border-wa-border-dark">
            {selected && (
              <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                Se moverá el historial de {displayName(selected)} a {displayName(chat)} y se borrará el registro de {displayName(selected)}. No se puede deshacer.
              </p>
            )}
            <Button onClick={submit} disabled={!selected || isPending} aria-busy={isPending} className="w-full">
              {isPending
                ? <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />
                : <GitMerge aria-hidden="true" className="h-4 w-4" />}
              Fusionar
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
