import { History } from 'lucide-react'
import type { HistoryMessage } from '../types'
import { formatMessageTime, parseContent } from '../utils/message'
import { MapPreview } from './MapPreview'
import { RichText } from './RichText'

interface Props {
  message: HistoryMessage
  /** Primero de una tanda del mismo autor: solo ese lleva la etiqueta. */
  isFirstOfGroup: boolean
}

/**
 * Mensaje traído de WhatsApp que no está en la base. Se dibuja apagado y con
 * borde punteado para que se distinga de un mensaje registrado, y sin colita
 * ni tildes de entrega: de este mensaje no sabemos su estado, no se puede
 * citar, ni reintentar, ni saltar a él desde la búsqueda.
 *
 * De los adjuntos solo llega el tipo y el epígrafe (el archivo no se
 * descarga), así que se muestran con el mismo chip que un mensaje propio cuyo
 * archivo no está disponible. La ubicación es la excepción: las coordenadas
 * viajan en el texto y alcanzan para dibujar el mapa.
 */
export function HistoryMessageBubble({ message, isFirstOfGroup }: Props) {
  const isVendedor = message.sender === 'vendedor'
  const { kind, icon: Icon, label, text } = parseContent(message.content)

  return (
    <div className={`flex ${isVendedor ? 'justify-end' : 'justify-start'} ${isFirstOfGroup ? 'mt-3' : 'mt-[3px]'}`}>
      <div
        className={`max-w-[75%] rounded-bubble border border-dashed px-3.5 py-2 text-sm text-wa-text/90 dark:text-wa-text-dark/90 ${
          isVendedor
            ? 'border-wa-primary/40 bg-wa-out/50 dark:border-wa-primary/40 dark:bg-wa-out-dark/40'
            : 'border-wa-border bg-white/50 dark:border-wa-border-dark dark:bg-wa-in-dark/40'
        }`}
      >
        {isFirstOfGroup && (
          <div className="mb-1 inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
            <History aria-hidden="true" className="h-3 w-3" />
            <span>Historial de WhatsApp</span>
          </div>
        )}

        {kind !== 'text' && kind !== 'location' && Icon && (
          <div className="mb-1 inline-flex items-center gap-1 rounded bg-black/5 px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-wa-muted dark:bg-white/10 dark:text-wa-text-dark/70">
            <Icon className="h-3 w-3" />
            <span>{label}</span>
          </div>
        )}

        {kind === 'location' && (() => {
          const [lat, lon] = text.split(',').map(Number)
          if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
          return (
            <a
              href={`https://www.google.com/maps?q=${lat},${lon}`}
              target="_blank"
              rel="noopener noreferrer"
              className="block w-56 overflow-hidden rounded-lg transition-opacity hover:opacity-90"
            >
              <MapPreview latitude={lat} longitude={lon} className="rounded-lg" />
            </a>
          )
        })()}

        {kind !== 'other' && kind !== 'location' && (
          <p className={`whitespace-pre-wrap ${kind !== 'text' ? 'italic text-wa-muted dark:text-wa-text-dark/70' : ''}`}>
            {text ? <RichText text={text} /> : label}
          </p>
        )}

        {kind === 'other' && (
          <p className="whitespace-pre-wrap italic text-wa-muted dark:text-wa-text-dark/70">{text || label}</p>
        )}

        <div className="mt-0.5 text-right text-[10px] text-wa-muted dark:text-wa-muted-dark">
          {formatMessageTime(message.sent_at)}
        </div>
      </div>
    </div>
  )
}
