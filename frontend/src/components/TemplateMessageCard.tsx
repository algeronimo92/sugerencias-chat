import { CornerUpLeft, ExternalLink } from 'lucide-react'

import type { TemplateMessage } from '../utils/message'

/**
 * Lo que va arriba del cuerpo, como en WhatsApp: el preview del enlace en los
 * anuncios de plantilla, o la pregunta original cuando el mensaje es la
 * respuesta del cliente a un botón.
 */
export function TemplateMessagePreview({
  template,
  hasQuote = false,
}: {
  template: TemplateMessage
  /** Si el mensaje ya trae la cita nativa de la app, no repetimos la pregunta. */
  hasQuote?: boolean
}) {
  if (template.answeredQuestion) {
    if (hasQuote) return null
    return (
      <div className="mb-1.5 flex items-start gap-1.5 rounded-lg border-l-[3px] border-wa-primary/70 bg-black/5 px-2.5 py-1.5 dark:bg-white/10">
        <CornerUpLeft className="mt-0.5 h-3 w-3 shrink-0 text-wa-muted dark:text-wa-text-dark/60" />
        <p className="line-clamp-2 text-[12px] leading-snug text-wa-muted dark:text-wa-text-dark/70">
          {template.answeredQuestion}
        </p>
      </div>
    )
  }

  if (!template.title && !template.description && !template.domain) return null
  const href = template.buttons.find((button) => button.url)?.url ?? null

  const card = (
    <>
      {template.title && (
        <p className="line-clamp-2 text-[13px] font-semibold text-wa-text dark:text-wa-text-dark">
          {template.title}
        </p>
      )}
      {template.domain && (
        <p className="mt-0.5 flex items-center gap-1 text-[11px] text-wa-muted dark:text-wa-text-dark/60">
          <ExternalLink className="h-3 w-3 shrink-0" />
          <span className="truncate">{template.domain}</span>
        </p>
      )}
      {template.description && (
        <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-wa-muted dark:text-wa-text-dark/60">
          {template.description}
        </p>
      )}
    </>
  )

  const className = 'mb-1.5 block rounded-lg bg-black/5 px-2.5 py-2 dark:bg-white/10'
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className={`${className} transition-colors hover:bg-black/10 dark:hover:bg-white/15`}>
      {card}
    </a>
  ) : (
    <div className={className}>{card}</div>
  )
}

/**
 * Botones de la plantilla: tarjetas propias debajo de la burbuja, con el mismo
 * color y separadas por un hilo de aire, como las dibuja WhatsApp. Los que
 * abren un enlace son clicables; los de respuesta rápida se muestran igual
 * pero inertes, porque son acciones del cliente, no del vendedor.
 */
export function TemplateMessageButtons({
  template,
  isVendedor,
}: {
  template: TemplateMessage
  isVendedor: boolean
}) {
  if (!template.buttons.length) return null
  const surface = isVendedor ? 'bg-wa-out dark:bg-wa-out-dark' : 'bg-white dark:bg-wa-in-dark'
  const base = `flex items-center justify-center gap-2 rounded-bubble px-3 py-2.5 text-[13px] font-medium shadow-sm ${surface}`

  return (
    <div className="mt-0.5 flex flex-col gap-0.5">
      {template.buttons.map((button, index) =>
        button.url ? (
          <a
            key={index}
            href={button.url}
            target="_blank"
            rel="noopener noreferrer"
            className={`${base} text-sky-600 transition-colors hover:brightness-95 dark:text-wa-accent`}
          >
            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{button.text}</span>
          </a>
        ) : (
          <p
            key={index}
            title="Botón que ve el cliente en WhatsApp"
            className={`${base} text-sky-600 dark:text-wa-accent`}
          >
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{button.text}</span>
          </p>
        ),
      )}
    </div>
  )
}
