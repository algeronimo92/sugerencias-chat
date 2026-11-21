import { ExternalLink, Megaphone } from 'lucide-react'
import { useState, type SyntheticEvent } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Modal } from '../../../shared/ui/Modal'
import type { AdReferral } from '../../whatsapp/public/message'

/** Tarjeta del anuncio del que vino el lead (Click-to-WhatsApp de Meta), como
 * la que WhatsApp muestra sobre el primer mensaje: miniatura + título + un
 * rótulo "Del anuncio".
 *
 * Tocarla abre el anuncio dentro del CRM, como hace WhatsApp. Antes era un
 * link a Facebook: en el celular sacaba a la vendedora de la conversación
 * (abría la app de Facebook o pedía iniciar sesión) solo para leer el texto
 * del anuncio, que ya viene en el mensaje. Facebook queda como enlace aparte
 * en el detalle. */
export function AdReferralCard({ ad }: { ad: AdReferral }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          // Abrir el anuncio no es tocar la burbuja: en modo selección no la marca.
          event.stopPropagation()
          setOpen(true)
        }}
        aria-label={`Ver el anuncio${ad.title ? ` ${ad.title}` : ''}`}
        className="mb-1 block w-full cursor-pointer overflow-hidden rounded-md border-l-4 border-wa-primary bg-black/5 text-left outline-none hover:bg-black/10 focus-visible:ring-2 focus-visible:ring-ring dark:bg-white/10 dark:hover:bg-white/15"
      >
        <span className="flex items-center gap-1 px-2 pt-1.5 text-[11px] font-semibold text-wa-primary-strong dark:text-wa-primary">
          <Megaphone aria-hidden="true" className="h-3 w-3" />
          Del anuncio
        </span>
        <span className="flex gap-2 px-2 pb-2 pt-1">
          {ad.thumbnailUrl && (
            <img
              src={ad.thumbnailUrl}
              alt=""
              loading="lazy"
              className="h-12 w-12 shrink-0 rounded object-cover"
            />
          )}
          <span className="min-w-0">
            {ad.title && (
              <span className="block truncate text-xs font-medium text-wa-text dark:text-wa-text-dark">{ad.title}</span>
            )}
            {ad.body && (
              <span className="line-clamp-2 text-[11px] text-wa-muted dark:text-wa-text-dark/70">{ad.body}</span>
            )}
          </span>
        </span>
      </button>
      {open && (
        // El modal se dibuja en un portal, pero sus eventos suben por el árbol
        // de React hasta la burbuja: sin este corte, tocar "Cerrar" activaba
        // la selección del mensaje o el gesto de deslizar para responder.
        <span
          className="contents"
          onClick={stopPropagation}
          onPointerDown={stopPropagation}
          onPointerMove={stopPropagation}
          onPointerUp={stopPropagation}
          onContextMenu={stopPropagation}
        >
          <AdReferralDialog ad={ad} onClose={() => setOpen(false)} />
        </span>
      )}
    </>
  )
}

function stopPropagation(event: SyntheticEvent) {
  event.stopPropagation()
}

function AdReferralDialog({ ad, onClose }: { ad: AdReferral; onClose: () => void }) {
  return (
    <Modal
      title={ad.title || 'Anuncio'}
      description="El anuncio desde el que el cliente escribió."
      icon={<Megaphone className="h-4 w-4" aria-hidden="true" />}
      onClose={onClose}
      // Sin "Cerrar" en el pie: el modal ya trae su X con ese nombre.
      footer={ad.sourceUrl ? (
        <Button asChild variant="secondary">
          <a href={ad.sourceUrl} target="_blank" rel="noopener noreferrer">
            <ExternalLink className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Ver en Facebook
          </a>
        </Button>
      ) : undefined}
    >
      {ad.thumbnailUrl && (
        <img
          src={ad.thumbnailUrl}
          alt={ad.title ? `Imagen del anuncio ${ad.title}` : 'Imagen del anuncio'}
          className="mb-3 max-h-72 w-full rounded-lg bg-subtle object-contain"
        />
      )}
      {ad.body ? (
        <p className="whitespace-pre-line break-words text-sm text-fg">{ad.body}</p>
      ) : (
        <p className="text-sm text-fg-muted">Este anuncio no trae texto.</p>
      )}
    </Modal>
  )
}
