import { Braces, Check, Copy, History, Loader2, Save } from 'lucide-react'
import { Button } from '../../../../shared/ui/Button'
import { Modal } from '../../../../shared/ui/Modal'
import type { AutomationFlowDefinition, AutomationFlowVersion } from '../../types'

/**
 * Los modales propios del editor de flujos: versiones, JSON y salir con
 * cambios sin guardar. Antes eran `div`s fijos dentro de VisualFlowBuilder,
 * sin Escape ni foco atrapado; ahora usan el `Modal` común.
 */

export function FlowVersionsDialog({ versions, loading, restoring, onRestore, onClose }: {
  versions: AutomationFlowVersion[]
  loading: boolean
  restoring: boolean
  onRestore: (version: number) => void
  onClose: () => void
}) {
  return (
    <Modal
      title="Versiones publicadas"
      description="Restaurar copia esa versión en el borrador. Los leads siguen con la publicada hasta que publiques."
      icon={<History className="h-4 w-4" />}
      onClose={onClose}
    >
      {loading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-wa-muted" aria-label="Cargando versiones" /></div>
      ) : versions.length === 0 ? (
        <p className="py-8 text-center text-sm text-wa-muted dark:text-wa-muted-dark">Esta automatización todavía no se publicó.</p>
      ) : (
        <ul className="space-y-2">
          {versions.map(item => (
            <li key={item.version} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${item.is_current ? 'border-wa-primary/40 bg-wa-primary/5' : 'border-wa-border dark:border-wa-border-dark'}`}>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  Versión {item.version}
                  {item.is_current && <span className="rounded-full bg-wa-primary px-1.5 py-0.5 text-[10px] font-bold text-white">En uso</span>}
                </p>
                <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                  {item.node_count} pasos · {item.edge_count} conexiones · {new Date(item.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}
                </p>
              </div>
              <Button variant="secondary" size="sm" disabled={restoring} onClick={() => onRestore(item.version)}>Restaurar</Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

export function FlowJsonDialog({ tab, onTabChange, draft, published, publishedVersion, copied, onCopy, onClose }: {
  tab: 'draft' | 'published'
  onTabChange: (tab: 'draft' | 'published') => void
  draft: AutomationFlowDefinition
  published: AutomationFlowDefinition | null
  publishedVersion?: number | null
  copied: boolean
  onCopy: (text: string) => void
  onClose: () => void
}) {
  const text = JSON.stringify(tab === 'published' ? (published ?? draft) : draft, null, 2)
  const tabClass = (active: boolean) => `rounded-md px-3 py-1.5 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/60 disabled:cursor-not-allowed disabled:opacity-40 ${active
    ? 'bg-white text-wa-text shadow-sm dark:bg-wa-active-dark dark:text-wa-text-dark'
    : 'text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'}`
  return (
    <Modal
      title="JSON de la automatización"
      description="Los pasos y conexiones, tal como se guardan."
      icon={<Braces className="h-4 w-4" />}
      size="lg"
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cerrar</Button>
        <Button variant="secondary" onClick={() => onCopy(text)}>
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? 'Copiado' : 'Copiar JSON'}
        </Button>
      </>}
    >
      <div className="space-y-3">
        <div role="tablist" aria-label="Versión de la automatización" className="inline-flex rounded-lg bg-wa-hover p-1 dark:bg-wa-head-dark">
          <button type="button" role="tab" aria-selected={tab === 'draft'} onClick={() => onTabChange('draft')} className={tabClass(tab === 'draft')}>Borrador actual</button>
          <button
            type="button" role="tab" aria-selected={tab === 'published'} disabled={!published}
            title={!published ? 'Esta automatización aún no se publicó' : undefined}
            onClick={() => onTabChange('published')} className={tabClass(tab === 'published')}
          >Publicada{publishedVersion ? ` (v${publishedVersion})` : ''}</button>
        </div>
        <pre className="max-h-[55dvh] overflow-auto rounded-xl bg-wa-hover p-3 text-[11px] leading-relaxed text-gray-800 dark:bg-wa-head-dark dark:text-gray-200"><code>{text}</code></pre>
      </div>
    </Modal>
  )
}

export function UnsavedChangesDialog({ busy, onKeepEditing, onDiscard, onSave }: {
  busy: boolean
  onKeepEditing: () => void
  onDiscard: () => void
  onSave: () => void
}) {
  return (
    <Modal
      alert
      layer="confirm"
      title="Hay cambios sin guardar"
      description="Guarda el borrador para no perderlos. Guardarlo no cambia la versión publicada."
      busy={busy}
      onClose={onKeepEditing}
      footer={<>
        <Button variant="ghost" disabled={busy} onClick={onKeepEditing}>Seguir editando</Button>
        <Button variant="secondary" disabled={busy} onClick={onDiscard} className="text-red-600 dark:text-red-400">Salir sin guardar</Button>
        <Button disabled={busy} onClick={onSave}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar y salir</Button>
      </>}
    />
  )
}
