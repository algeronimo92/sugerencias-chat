import { Check, Library, Loader2, X } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from '../../../shared/ui/Dialog'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { ServiceChecklist } from './ServiceChecklist'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useLeadServices } from '../../catalogs/public/useLeadServices'
import { matchServices } from '../domain/knowledgeTemplateMatch'
import { useImportKnowledgeTemplate, useKnowledgeDocuments, useKnowledgeTemplates } from '../queries'
import type { KnowledgeTemplateSummary } from '../types'

const TYPE_LABELS: Record<string, string> = {
  ficha: 'Ficha del servicio', faq: 'Preguntas frecuentes', guion: 'Guion de venta u objeciones', politica: 'Política del negocio', otro: 'Otro',
}

interface Props {
  /** Servicio que se está mirando en Conocimiento: gana a la sugerencia de la plantilla. */
  preferredServiceId: number | null
  onClose: () => void
  /** Abre un documento en el editor: la copia recién importada o la que ya existía. */
  onOpenDocument: (documentId: string) => void
}

/**
 * Biblioteca de la plataforma: fichas, preguntas frecuentes y guiones modelo.
 * Importar crea una copia que es del negocio: se edita libremente y no cambia
 * si la plataforma actualiza la plantilla después. Si ya se importó, lo
 * primero es abrir esa copia: antes el botón único volvía a importar y
 * aparecían dos "Ficha: Botox" iguales (2026-11-09).
 */
export function KnowledgeTemplatesDialog({ preferredServiceId, onClose, onOpenDocument }: Props) {
  const { data: templates = [], isLoading, error } = useKnowledgeTemplates(true)
  const { data: documents = [] } = useKnowledgeDocuments()
  const { data: services = [] } = useLeadServices()
  const importTemplate = useImportKnowledgeTemplate()
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [servicesByTemplate, setServicesByTemplate] = useState<Record<number, number[]>>({})
  const listRef = useRef<HTMLUListElement>(null)
  const selected = templates.find(template => template.id === selectedId) ?? templates[0] ?? null
  const existingCopy = selected ? documents.find(document => document.template_id === selected.id) : undefined

  const activeServices = useMemo(() => services.filter(service => service.is_active !== false), [services])
  function servicesFor(template: KnowledgeTemplateSummary): number[] {
    if (template.id in servicesByTemplate) return servicesByTemplate[template.id]
    return preferredServiceId ? [preferredServiceId] : matchServices(template.service_hint, activeServices)
  }

  function handleImport(template: KnowledgeTemplateSummary) {
    importTemplate.mutate({ templateId: template.id, serviceIds: servicesFor(template) }, {
      onSuccess: document => {
        toast.success('Plantilla importada: ahora es tuya. Edítala a tu gusto.')
        onOpenDocument(document.id)
      },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          // El foco arranca en la lista, no en "Cerrar".
          onOpenAutoFocus={event => { event.preventDefault(); listRef.current?.querySelector('button')?.focus() }}
          className={`${dialogContentPositionClass} flex max-h-[85vh] w-[calc(100%-2rem)] max-w-4xl flex-col overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
        >
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
            <button type="button" onClick={onClose} aria-label="Cerrar" className="-m-2 shrink-0 rounded-lg p-2 text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark">
              <X className="h-5 w-5" />
            </button>
          </div>

          {isLoading ? (
            <p className="p-6 text-sm text-wa-muted dark:text-wa-muted-dark">Cargando plantillas…</p>
          ) : error ? (
            <p role="alert" className="p-6 text-sm text-red-600 dark:text-red-300">{extractErrorMessage(error)}</p>
          ) : templates.length === 0 ? (
            <div className="p-6"><EmptyState icon={Library} title="Todavía no hay plantillas" description="Cuando la plataforma publique fichas modelo, aparecerán aquí para importarlas." /></div>
          ) : (
            // En un teléfono todo el cuerpo hace scroll junto (lista corta
            // arriba, vista previa y pie debajo); antes la vista previa quedaba
            // a 0 px y el botón de importar fuera del diálogo.
            <div className="grid min-h-0 flex-1 overflow-y-auto md:grid-cols-[minmax(0,280px)_minmax(0,1fr)] md:overflow-hidden">
              <ul ref={listRef} className="max-h-44 overflow-y-auto border-b border-wa-border p-2 md:max-h-none md:min-h-0 md:border-b-0 md:border-r dark:border-wa-border-dark" aria-label="Plantillas disponibles">
                {templates.map(template => (
                  <li key={template.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      aria-current={selected?.id === template.id || undefined}
                      className={`w-full rounded-lg px-3 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${selected?.id === template.id ? 'bg-wa-primary/10' : 'hover:bg-wa-hover dark:hover:bg-wa-head-dark'}`}
                    >
                      <span className="block truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">{template.title}</span>
                      <span className="flex items-center gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
                        {TYPE_LABELS[template.document_type ?? ''] ?? 'Sin tipo'}
                        {template.service_hint ? ` · ${template.service_hint}` : ''}
                        {template.imported && <span className="inline-flex items-center gap-0.5 text-wa-primary-strong dark:text-wa-primary"><Check className="h-3 w-3" aria-hidden="true" />ya la tienes</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {selected && (
                <div className="flex min-h-0 flex-col">
                  <div className="p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
                    <h3 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{selected.title}</h3>
                    <p className="mt-0.5 text-xs text-wa-muted dark:text-wa-muted-dark">Versión {selected.version} · {selected.characters.toLocaleString('es-PE')} caracteres</p>
                    <pre className="mt-3 whitespace-pre-wrap rounded-lg bg-wa-field p-3 font-sans text-sm leading-6 text-wa-text dark:bg-wa-field-dark dark:text-wa-text-dark">{selected.content}</pre>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-wa-border p-4 md:flex-row md:items-end dark:border-wa-border-dark">
                    <div className="min-w-0 flex-1">
                      <ServiceChecklist
                        label="Vincular a mis servicios"
                        services={services}
                        selected={servicesFor(selected)}
                        onChange={ids => setServicesByTemplate(current => ({ ...current, [selected.id]: ids }))}
                      />
                    </div>
                    <div className="flex shrink-0 flex-col gap-2">
                      {existingCopy ? (
                        <>
                          <Button className="h-10" onClick={() => onOpenDocument(existingCopy.id)}>Abrir mi copia</Button>
                          <Button variant="ghost" size="sm" onClick={() => handleImport(selected)} disabled={importTemplate.isPending}>
                            {importTemplate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                            Importar otra copia
                          </Button>
                        </>
                      ) : (
                        <Button className="h-10" onClick={() => handleImport(selected)} disabled={importTemplate.isPending}>
                          {importTemplate.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
                          Importar y editar
                        </Button>
                      )}
                    </div>
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
