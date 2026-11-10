/**
 * Vista previa ampliada desde la página Archivos: una imagen a tamaño real
 * o un PDF en el visor de documentos.
 */
import { ExternalLink, X } from 'lucide-react'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from '../../../shared/ui/Dialog'
import { DocumentViewer } from '../../../shared/ui/DocumentViewer'
import { resolveMediaUrl } from '../../whatsapp/public/message'
import { isPdfAsset } from '../domain/assets'
import type { MediaAsset } from '../types'

interface Props {
  asset: MediaAsset | null
  onClose: () => void
}

export function AssetPreviewDialog({ asset, onClose }: Props) {
  if (asset && isPdfAsset(asset)) {
    return <DocumentViewer src={resolveMediaUrl(asset.media_url) ?? ''} filename={asset.filename} onClose={onClose} />
  }
  return (
      <Dialog.Root open={asset != null} onOpenChange={open => { if (!open) onClose() }}>
        <Dialog.Portal>
          <Dialog.Overlay className={`${dialogOverlayClass} bg-black/75`} />
          <Dialog.Content className={`${dialogContentPositionClass} flex max-h-[92vh] w-[calc(100%-2rem)] max-w-6xl flex-col overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
            <div className="flex items-center justify-between gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
              <Dialog.Title className="min-w-0 truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                {asset?.filename ?? 'Vista previa'}
              </Dialog.Title>
              <div className="flex shrink-0 items-center gap-1">
                {asset && <a href={resolveMediaUrl(asset.media_url) ?? '#'} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/40"><ExternalLink className="h-3.5 w-3.5" />Abrir original</a>}
                <Dialog.Close asChild><button type="button" title="Cerrar vista previa" className="rounded-lg p-2 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"><X className="h-4 w-4" /></button></Dialog.Close>
              </div>
            </div>
            <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-wa-app p-3 dark:bg-wa-app-dark sm:p-5">
              {asset && <img src={resolveMediaUrl(asset.media_url) ?? ''} alt={asset.filename} className="max-h-[calc(92vh-5rem)] max-w-full rounded-lg object-contain shadow-lg" />}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
  )
}
