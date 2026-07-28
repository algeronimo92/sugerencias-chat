import { quotePreview } from '../utils/message'

/** Recuadro del mensaje citado, como el que WhatsApp pone arriba de una
 * respuesta: barra de color, autor y una línea de vista previa. El color
 * distingue de quién era el mensaje original, no quién responde.
 *
 * Lo usan las burbujas del hilo (para las respuestas ya enviadas) y el
 * compositor (para la respuesta que se está por mandar). */
export function QuotedMessage({
  sender,
  content,
  contactName,
  onJump,
  className = '',
}: {
  sender: string
  content: string | null
  contactName: string
  onJump?: () => void
  className?: string
}) {
  const { icon: Icon, label, text } = quotePreview(content)
  const isMine = sender === 'vendedor'
  const accent = isMine
    ? 'border-wa-primary text-wa-primary-strong dark:text-wa-primary'
    : 'border-sky-500 text-sky-600 dark:text-sky-400'
  return (
    <button
      type="button"
      onClick={onJump}
      disabled={!onJump}
      title={onJump ? 'Ir al mensaje original' : undefined}
      className={`flex w-full min-w-0 flex-col items-start gap-0.5 overflow-hidden rounded-md border-l-4 bg-black/5 px-2 py-1 text-left dark:bg-white/10 ${accent} ${
        onJump ? 'hover:bg-black/10 dark:hover:bg-white/15' : 'cursor-default'
      } ${className}`}
    >
      <span className="text-[11px] font-semibold leading-tight">
        {isMine ? 'Vos' : contactName}
      </span>
      <span className="flex w-full min-w-0 items-center gap-1 text-xs leading-tight text-wa-muted dark:text-wa-text-dark/70">
        {Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />}
        {label && !text && <span>{label}</span>}
        {text && <span className="truncate">{text}</span>}
      </span>
    </button>
  )
}
