import { CheckCheck } from 'lucide-react'
import type { MessageSearchHit } from '../../leads/types'
import { avatarInitial } from '../../leads/public/chat'
import { highlightSegments, searchSnippet } from '../../whatsapp/public/message'
import { formatHitDate, hitName } from '../searchMatch'

interface Props {
  hit: MessageSearchHit
  search: string
  /** El mensaje abierto en el hilo: el mismo chat puede salir varias veces. */
  isSelected: boolean
  onClick: () => void
}

/** Texto con las palabras buscadas resaltadas. */
export function Highlighted({ text, search }: { text: string; search: string }) {
  return (
    <>
      {highlightSegments(text, search).map((segment, index) =>
        segment.match
          ? <mark key={index} className="bg-transparent font-semibold text-wa-primary-strong dark:text-wa-primary">{segment.text}</mark>
          : <span key={index}>{segment.text}</span>,
      )}
    </>
  )
}

/** Un mensaje que contiene la búsqueda: de quién es el chat, cuándo se mandó,
 *  si lo mandó el negocio y el texto con lo buscado resaltado. */
export function MessageSearchRow({ hit, search, isSelected, onClick }: Props) {
  const fromBusiness = hit.sender !== 'cliente'
  // Una sola línea: los saltos del mensaje se aplanan para que el recorte
  // muestre lo buscado y no un renglón vacío.
  const text = searchSnippet((hit.text ?? '').replace(/\s+/g, ' ').trim(), search)
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mx-2 my-0.5 flex w-[calc(100%-1rem)] items-center gap-3 rounded-xl px-3 py-2.5 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wa-primary/60 ${
        isSelected
          ? 'bg-wa-primary/10 ring-1 ring-inset ring-wa-primary/15 dark:bg-wa-primary/15 dark:ring-wa-primary/20'
          : 'hover:bg-wa-hover dark:hover:bg-wa-hover-dark'
      }`}
    >
      <div aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-wa-primary to-wa-primary-strong text-sm font-bold text-white shadow-sm">
        {avatarInitial({ username: hit.username ?? null, name: hit.name ?? null })}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">{hitName(hit)}</span>
          <time dateTime={hit.sent_at ?? undefined} className="shrink-0 text-[11px] text-wa-muted dark:text-wa-muted-dark">
            {formatHitDate(hit.sent_at)}
          </time>
        </div>
        <p className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] text-wa-muted dark:text-wa-muted-dark">
          {fromBusiness && (
            <CheckCheck className="h-3.5 w-3.5 shrink-0" role="img" aria-label="Enviado por el negocio" />
          )}
          <span className="truncate"><Highlighted text={text} search={search} /></span>
        </p>
      </div>
    </button>
  )
}
