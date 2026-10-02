import { CornerUpLeft,ExternalLink } from 'lucide-react'

import { resolveMediaUrl,type TemplateMessage } from '../utils/message'

/** Encabezado de una plantilla oficial enviada: imagen o texto. */
export function TemplateMessagePreview({ template }: { template: TemplateMessage }) {
  // El encabezado de imagen ya está en el almacenamiento de la app desde que
  // la plantilla se creó o importó: se resuelve como cualquier otra imagen.
  const headerImageSrc = template.headerImageUrl ? resolveMediaUrl(template.headerImageUrl) : null
  return (
    <>
      {headerImageSrc && (
        <img src={headerImageSrc} alt="" loading="lazy" className="mb-1.5 max-h-48 w-full rounded-lg object-cover" />
      )}
      {template.title && (
        <p className="text-[13px] font-semibold text-wa-text dark:text-wa-text-dark">{template.title}</p>
      )}
    </>
  )
}

/**
 * Botones de la plantilla o del interactivo: tarjetas propias debajo de la
 * burbuja, con el mismo color y separadas por un hilo de aire, como las dibuja
 * WhatsApp. Los que abren un enlace son clicables; los de respuesta se
 * muestran igual pero inertes, porque son acciones del cliente, no del vendedor.
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
