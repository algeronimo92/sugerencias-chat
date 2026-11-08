import { Check, Library, Loader2, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from '../../../shared/ui/Dialog'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Select, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useLeadServices } from '../../catalogs/public/useLeadServices'
import { useImportKnowledgeTemplate, useKnowledgeTemplates } from '../queries'
import type { KnowledgeTemplateSummary } from '../types'

const TYPE_LABELS: Record<string, string> = {
  ficha: 'Ficha del servicio', faq: 'Preguntas frecuentes', guion: 'Guion de venta u objeciones', politica: 'Política del negocio', otro: 'Otro',
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

/** El servicio del catálogo que mejor corresponde a la sugerencia de la
 *  plantilla ("Hollywood Peel" → "Hollywood Peel - Rostro"); el admin lo cambia.
 *  Se compara por prefijo: el catálogo nombra "Servicio - Zona", y "Peel" no
 *  debería elegir "Hollywood Peel". */
function matchService(hint: string | null | undefined, services: { id: number; name: string }[]): number | null {
  if (!hint) return null
  const wanted = fold(hint)
  let best: { id: number; length: number } | null = null
  for (const service of services) {
    const name = fold(service.name)
    if (name === wanted) return service.id
    if (name.startsWith(wanted) && (best === null || name.length < best.length)) best = { id: service.id, length: name.length }
  }
  return best?.id ?? null
}

interface Props {
  /** Servicio que se está mirando en Conocimiento: gana a la sugerencia de la plantilla. */
  preferredServiceId: number | null
  onClose: () => void
  onImported: (documentId: string) => void
}

/**
 * Biblioteca de la plataforma: fichas, preguntas frecuentes y guiones modelo.
 * Importar crea una copia que es del negocio: se edita libremente y no cambia
 * si la plataforma actualiza la plantilla después.
 */
export function KnowledgeTemplatesDialog({ preferredServiceId, onClose, onImported }: Props) {
  const { data: templates = [], isLoading, error } = useKnowledgeTemplates(true)
  const { data: services = [] } = useLeadServices()
  const importTemplate = useImportKnowledgeTemplate()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [serviceByTemplate, setServiceByTemplate] = useState<Record<number, string>>({})
  const selected = templates.find(template => template.id === selectedId) ?? templates[0] ?? null

  const activeServices = useMemo(() => services.filter(service => service.is_active !== false), [services])
  function serviceFor(template: KnowledgeTemplateSummary): string {
    if (template.id in serviceByTemplate) return serviceByTemplate[template.id]
    const id = preferredServiceId ?? matchService(template.service_hint, activeServices)
    return id ? String(id) : ''
  }

  function handleImport(template: KnowledgeTemplateSummary) {
    const serviceId = serviceFor(template)
    importTemplate.mutate({ templateId: template.id, serviceId: serviceId ? Number(serviceId) : null }, {
      onSuccess: document => {
        toast.success('Plantilla importada: ahora es tuya. Edítala a tu gusto y guárdala.')
        onImported(document.id)
      },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={`${dialogContentPositionClass} flex max-h-[85vh] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
          <div className="flex items-start justify-between gap-3 border-b border-wa-border px-5 py-4 dark:border-wa-border-dark">
            <div>
              <Dialog.Title className="flex items-center gap-2 text-base font-semibold text-wa-text dark:text-wa-text-dark">
                <Library className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
                Plantillas de la plataforma
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
                Importa una ficha o guía modelo y adáptala a tu negocio. La copia es tuya: si la plantilla cambia, la tuya no.
              </Dialog.Description>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark">
              <X className="h-4 w-4" />
            </button>
          </div>

          {isLoading ? (
            <p className="p-6 text-sm text-wa-muted dark:text-wa-muted-dark">Cargando plantillas…</p>
          ) : error ? (
            <p role="alert" className="p-6 text-sm text-red-600 dark:text-red-300">{extractErrorMessage(error)}</p>
          ) : templates.length === 0 ? (
            <div className="p-6"><EmptyState icon={Library} title="Todavía no hay plantillas" description="Cuando la plataforma publique fichas modelo, aparecerán aquí para importarlas." /></div>
          ) : (
            <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
              <ul className="min-h-0 overflow-y-auto border-b border-wa-border p-2 md:border-b-0 md:border-r dark:border-wa-border-dark" aria-label="Plantillas disponibles">
                {templates.map(template => (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      aria-current={selected?.id === template.id}
                      className={`w-full rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${selected?.id === template.id ? 'bg-wa-primary/10' : 'hover:bg-wa-hover dark:hover:bg-wa-head-dark'}`}
                    >
                      <span className="block truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">{template.title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
                        {TYPE_LABELS[template.document_type ?? ''] ?? 'Sin tipo'}
                        {template.service_hint ? ` · ${template.service_hint}` : ''}
                        {template.imported && <span className="inline-flex items-center gap-0.5 text-wa-primary-strong dark:text-wa-primary"><Check className="h-3 w-3" aria-hidden="true" />importada</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {selected && (
                <div className="flex min-h-0 flex-col">
                  <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    <h3 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{selected.title}</h3>
                    <p className="mt-0.5 text-xs text-wa-muted dark:text-wa-muted-dark">Versión {selected.version} · {selected.characters.toLocaleString('es-PE')} caracteres</p>
                    <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-wa-field p-3 font-sans text-sm leading-6 text-wa-text dark:bg-wa-field-dark dark:text-wa-text-dark">{selected.content}</pre>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-wa-border p-4 sm:flex-row sm:items-end dark:border-wa-border-dark">
                    <div className="min-w-0 flex-1">
                      <label htmlFor="template-service" className={labelClass}>Vincular a mi servicio</label>
                      <Select id="template-service" aria-label="Vincular a mi servicio" value={serviceFor(selected)} onValueChange={value => setServiceByTemplate(current => ({ ...current, [selected.id]: value }))}>
                        <option value="">General (todos los servicios)</option>
                        {activeServices.map(service => <option key={service.id} value={String(service.id)}>{service.name}</option>)}
                      </Select>
                    </div>
                    <Button className="h-10" onClick={() => handleImport(selected)} disabled={importTemplate.isPending}>
                      {importTemplate.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                      {selected.imported ? 'Importar otra copia' : 'Importar y editar'}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
