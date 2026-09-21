import { useEffect, useState } from 'react'
import { ArrowLeft, Check, Loader2, Search, Send, UserRound, X } from 'lucide-react'
import { toast } from 'sonner'

import { EMPTY_CHAT_FILTERS, type Chat } from '../types'
import { useInfiniteChats } from '../hooks/useChats'
import { useSendContacts, type ReplyTarget } from '../hooks/useMessages'
import { avatarInitial, displayName, displayPhone } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'

const MAX_CONTACTS = 20

interface Props {
  chatId: string
  targetName: string
  replyTo: ReplyTarget | null
  onSent: () => void
  onClose: () => void
}

/** Selector múltiple y confirmación para compartir leads como contactos
 * nativos de WhatsApp. Los seleccionados viajan en un único mensaje. */
export function ContactSendDialog({ chatId, targetName, replyTo, onSent, onClose }: Props) {
  const [step, setStep] = useState<'select' | 'confirm'>('select')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selected, setSelected] = useState<Chat[]>([])
  const { mutate: sendContacts, isPending } = useSendContacts(chatId)

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => window.clearTimeout(timeout)
  }, [search])

  const { data, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage } =
    useInfiniteChats(debouncedSearch, EMPTY_CHAT_FILTERS)
  const contacts = data?.pages.flatMap(page => page.items) ?? []

  function toggle(contact: Chat) {
    if (!contact.phone) return
    setSelected(current => {
      if (current.some(item => item.chat_id === contact.chat_id)) {
        return current.filter(item => item.chat_id !== contact.chat_id)
      }
      if (current.length >= MAX_CONTACTS) {
        toast.error(`Podés enviar hasta ${MAX_CONTACTS} contactos a la vez`)
        return current
      }
      return [...current, contact]
    })
  }

  function submit() {
    if (!selected.length || isPending) return
    sendContacts(
      {
        contacts: selected.map(contact => ({
          fullName: displayName(contact),
          phoneNumber: contact.phone as string,
        })),
        replyTo,
      },
      {
        onSuccess: () => {
          toast.success(selected.length === 1 ? 'Contacto enviado' : `${selected.length} contactos enviados`)
          onSent()
          onClose()
        },
        onError: error => toast.error(extractErrorMessage(error)),
      },
    )
  }

  const countLabel = selected.length === 1 ? '1 contacto' : `${selected.length} contactos`

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !isPending) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          className={`${dialogContentPositionClass} flex h-[85vh] max-h-[44rem] w-[calc(100%-2rem)] max-w-xl flex-col overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
          aria-describedby={undefined}
        >
          {step === 'select' ? (
            <>
              <div className="flex items-center gap-3 px-4 py-4">
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Cerrar"
                  className="rounded-full p-1.5 text-wa-muted hover:bg-wa-field dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"
                >
                  <X className="h-5 w-5" />
                </button>
                <Dialog.Title className="text-base font-semibold text-wa-text dark:text-wa-text-dark">
                  Envía contactos
                </Dialog.Title>
              </div>

              <div className="px-5 pb-4">
                <div className="relative">
                  <Search aria-hidden="true" className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" />
                  <input
                    type="search"
                    autoFocus
                    value={search}
                    onChange={event => setSearch(event.target.value)}
                    placeholder="Buscar un nombre o número"
                    className="w-full rounded-full border-2 border-wa-primary bg-transparent py-3 pl-11 pr-4 text-sm text-wa-text outline-none placeholder:text-wa-muted focus:ring-2 focus:ring-wa-primary/20 dark:text-wa-text-dark dark:placeholder:text-wa-muted-dark"
                  />
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto">
                <p className="px-6 pb-2 pt-3 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
                  Contactos del CRM
                </p>
                {isLoading ? (
                  <div className="flex justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-wa-muted" />
                  </div>
                ) : contacts.length === 0 ? (
                  <p className="px-5 py-12 text-center text-sm text-wa-muted dark:text-wa-muted-dark">
                    No se encontraron contactos.
                  </p>
                ) : (
                  <ul>
                    {contacts.map(contact => {
                      const checked = selected.some(item => item.chat_id === contact.chat_id)
                      const hasPhone = !!contact.phone
                      return (
                        <li key={contact.chat_id}>
                          <button
                            type="button"
                            onClick={() => toggle(contact)}
                            disabled={!hasPhone}
                            aria-pressed={checked}
                            className="flex w-full items-center gap-3 px-6 py-3 text-left transition-colors hover:bg-wa-hover disabled:cursor-not-allowed disabled:opacity-45 dark:hover:bg-wa-hover-dark"
                          >
                            <span
                              aria-hidden="true"
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border-2 ${
                                checked ? 'border-wa-primary bg-wa-primary text-white' : 'border-wa-muted/70 dark:border-wa-muted-dark'
                              }`}
                            >
                              {checked && <Check className="h-3.5 w-3.5" />}
                            </span>
                            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-wa-primary to-wa-primary-strong text-sm font-semibold text-white">
                              {avatarInitial(contact)}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">
                                {displayName(contact)}
                              </span>
                              <span className="block truncate text-xs text-wa-muted dark:text-wa-muted-dark">
                                {hasPhone ? displayPhone(contact) : 'Sin número para compartir'}
                              </span>
                            </span>
                          </button>
                        </li>
                      )
                    })}
                    {hasNextPage && (
                      <li className="p-3 text-center">
                        <button
                          type="button"
                          onClick={() => { if (!isFetchingNextPage) void fetchNextPage() }}
                          disabled={isFetchingNextPage}
                          className="rounded-full bg-wa-field px-4 py-2 text-xs font-medium text-wa-muted hover:bg-wa-hover disabled:cursor-wait dark:bg-wa-head-dark dark:text-wa-muted-dark"
                        >
                          {isFetchingNextPage ? 'Cargando...' : 'Cargar más contactos'}
                        </button>
                      </li>
                    )}
                  </ul>
                )}
              </div>

              <div className="flex items-center justify-between gap-3 border-t border-wa-border px-5 py-3 dark:border-wa-border-dark">
                <span className="text-sm text-wa-muted dark:text-wa-muted-dark">
                  {selected.length ? countLabel : 'Selecciona uno o más contactos'}
                </span>
                <button
                  type="button"
                  onClick={() => setStep('confirm')}
                  disabled={!selected.length}
                  aria-label="Continuar"
                  className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-wa-primary text-white shadow-md hover:bg-wa-primary-strong disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-5 w-5" />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-start gap-3 border-b border-wa-border px-4 py-4 dark:border-wa-border-dark">
                <button
                  type="button"
                  onClick={() => setStep('select')}
                  disabled={isPending}
                  aria-label="Volver a contactos"
                  className="rounded-full p-1.5 text-wa-muted hover:bg-wa-field disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"
                >
                  <ArrowLeft className="h-5 w-5" />
                </button>
                <Dialog.Title className="pt-1 text-base font-semibold text-wa-text dark:text-wa-text-dark">
                  ¿Deseas enviar {countLabel} a &quot;{targetName}&quot;?
                </Dialog.Title>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-2">
                {selected.map(contact => (
                  <div key={contact.chat_id} className="border-b border-wa-border py-4 last:border-b-0 dark:border-wa-border-dark">
                    <div className="flex items-center gap-3">
                      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-wa-primary/15 font-semibold text-wa-primary-strong dark:text-wa-primary">
                        {avatarInitial(contact) || <UserRound className="h-6 w-6" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">{displayName(contact)}</p>
                        <div className="mt-2 flex items-center gap-2">
                          <span className="flex h-5 w-5 items-center justify-center rounded bg-wa-primary text-white">
                            <Check className="h-3.5 w-3.5" />
                          </span>
                          <div>
                            <p className="text-sm text-wa-text dark:text-wa-text-dark">{displayPhone(contact)}</p>
                            <p className="text-xs text-wa-primary-strong dark:text-wa-primary">Teléfono móvil</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex justify-end px-5 py-4">
                <button
                  type="button"
                  onClick={submit}
                  disabled={isPending}
                  aria-label={`Enviar ${countLabel}`}
                  className="flex h-14 w-14 items-center justify-center rounded-full bg-wa-primary text-white shadow-lg hover:bg-wa-primary-strong disabled:cursor-wait disabled:opacity-60"
                >
                  {isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-6 w-6" />}
                </button>
              </div>
            </>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
