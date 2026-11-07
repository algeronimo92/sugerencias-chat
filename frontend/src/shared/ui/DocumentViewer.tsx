/**
 * Visor de PDF dentro de la app: el navegador lo pinta en un iframe, así una
 * lista de precios o un catálogo se lee sin salir de la pantalla ni bajar el
 * archivo. "Abrir en otra pestaña" queda como salida para los navegadores que
 * dentro de un iframe muestran solo la primera página (Safari en iPhone).
 */
import { Download, ExternalLink, Loader2, X } from 'lucide-react'
import { useState } from 'react'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './Dialog'
import { triggerMediaDownload } from '../utils/media'

interface Props {
  src: string
  filename: string
  onClose: () => void
}

const actionClass = 'flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/40'

export function DocumentViewer({ src, filename, onClose }: Props) {
  const [loaded, setLoaded] = useState(false)
  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={`${dialogOverlayClass} bg-black/75`} />
        <Dialog.Content
          aria-describedby={undefined}
          className={`${dialogContentPositionClass} flex h-[92vh] w-[calc(100%-2rem)] max-w-5xl flex-col overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
        >
          <div className="flex items-center justify-between gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <Dialog.Title className="min-w-0 truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">{filename}</Dialog.Title>
            <div className="flex shrink-0 items-center gap-1">
              <button type="button" onClick={() => triggerMediaDownload(src, filename)} className={actionClass}><Download className="h-3.5 w-3.5" aria-hidden="true" />Descargar</button>
              <a href={src} target="_blank" rel="noreferrer" className={actionClass}><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />Abrir en otra pestaña</a>
              <Dialog.Close asChild>
                <button type="button" title="Cerrar visor" aria-label="Cerrar visor" className="rounded-lg p-2 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"><X className="h-4 w-4" /></button>
              </Dialog.Close>
            </div>
          </div>
          <div className="relative min-h-0 flex-1 bg-wa-app dark:bg-wa-app-dark">
            {!loaded && (
              <div role="status" className="absolute inset-0 flex items-center justify-center text-wa-muted dark:text-wa-muted-dark">
                <Loader2 className="h-7 w-7 motion-safe:animate-spin" aria-hidden="true" />
                <span className="sr-only">Cargando documento…</span>
              </div>
            )}
            <iframe src={src} title={`Documento ${filename}`} onLoad={() => setLoaded(true)} className={`h-full w-full ${loaded ? 'opacity-100' : 'opacity-0'} transition-opacity duration-200`} />
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
