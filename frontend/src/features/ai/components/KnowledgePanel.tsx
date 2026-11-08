import { BookText, FileText, Library, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Input, Select, Textarea, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useLeadServices } from '../../catalogs/public/useLeadServices'
import {
  useDeleteKnowledgeDocument,
  useImportKnowledgePdf,
  useKnowledgeDocument,
  useKnowledgeDocuments,
  useSaveKnowledgeDocument,
} from '../queries'
import type { KnowledgeDocumentSummary, KnowledgeDocumentType } from '../types'
import { KnowledgeTemplatesDialog } from './KnowledgeTemplatesDialog'
import { panelClass } from './styles'

/**
 * Lo que el copiloto consulta para responder dudas, describir servicios y
 * manejar objeciones. Cada documento puede pertenecer a un servicio del
 * catálogo: cuando un lead se interesa en ese servicio, sus fichas entran
 * primero a la sugerencia. Sin servicio es conocimiento general (pagos,
 * garantías, ubicación).
 */
const DOCUMENT_TYPES: readonly { key: KnowledgeDocumentType; label: string }[] = [
  { key: 'ficha', label: 'Ficha del servicio' },
  { key: 'faq', label: 'Preguntas frecuentes' },
  { key: 'guion', label: 'Guion de venta u objeciones' },
  { key: 'politica', label: 'Política del negocio' },
  { key: 'otro', label: 'Otro' },
]

const GENERAL = 'general'
const ALL = 'todos'

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  // Por tramos: String.fromCharCode con un PDF entero desborda la pila.
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000))
  }
  return btoa(binary)
}

function useServiceNames() {
  const { data: services = [] } = useLeadServices(true)
  return useMemo(() => new Map(services.map(service => [service.id, service])), [services])
}

interface EditorProps {
  documentId: string | null
  defaultServiceId: number | null
  onDone: (id: string | null) => void
}

function KnowledgeEditor({ documentId, defaultServiceId, onDone }: EditorProps) {
  const { data, isLoading } = useKnowledgeDocument(documentId)
  if (documentId && (isLoading || !data)) return <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Cargando documento…</p>
  // El formulario arranca con los valores del documento ya puestos: si los
  // selectores se llenaran después de montarse, el de Radix los devolvía a
  // vacío y la ficha recién guardada se reabría como "General · Sin tipo".
  return (
    <KnowledgeForm
      documentId={documentId}
      initial={{
        title: data?.title ?? '',
        content: data?.content ?? '',
        documentType: data?.document_type ?? '',
        serviceId: data ? (data.service_id ? String(data.service_id) : '') : (defaultServiceId ? String(defaultServiceId) : ''),
      }}
      onDone={onDone}
    />
  )
}

interface FormProps {
  documentId: string | null
  initial: { title: string; content: string; documentType: string; serviceId: string }
  onDone: (id: string | null) => void
}

function KnowledgeForm({ documentId, initial, onDone }: FormProps) {
  const formId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const services = useServiceNames()
  const save = useSaveKnowledgeDocument()
  const remove = useDeleteKnowledgeDocument()
  const importPdf = useImportKnowledgePdf()
  const [title, setTitle] = useState(initial.title)
  const [content, setContent] = useState(initial.content)
  const [documentType, setDocumentType] = useState<string>(initial.documentType)
  const [serviceId, setServiceId] = useState<string>(initial.serviceId)

  async function importFile(file: File) {
    if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') {
      importPdf.mutate({ filename: file.name, dataBase64: await fileToBase64(file) }, {
        onSuccess: result => {
          setContent(result.content)
          if (!title.trim()) setTitle(result.title)
          toast.success(
            `Texto de ${result.pages} ${result.pages === 1 ? 'página' : 'páginas'} importado. Revísalo antes de guardar.`,
            result.truncated ? { description: 'El PDF era más largo que el máximo de 100.000 caracteres: se cortó al final.' } : undefined,
          )
        },
        onError: err => toast.error(extractErrorMessage(err)),
      })
      return
    }
    setContent(await file.text())
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  const activeServices = [...services.values()].filter(service => service.is_active !== false || String(service.id) === serviceId)

  return (
    <form
      className={panelClass}
      onSubmit={event => {
        event.preventDefault()
        save.mutate({
          id: documentId,
          title,
          content,
          document_type: (documentType || null) as KnowledgeDocumentType | null,
          service_id: serviceId ? Number(serviceId) : null,
        }, {
          onSuccess: saved => {
            toast.success(documentId ? 'Documento actualizado' : 'Documento creado')
            onDone(saved.id)
          },
          onError: err => toast.error(extractErrorMessage(err)),
        })
      }}
    >
      <label htmlFor={`${formId}-title`} className={labelClass}>Título</label>
      <Input id={`${formId}-title`} value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Ficha: limpieza facial profunda" required />

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor={`${formId}-service`} className={labelClass}>Servicio</label>
          <Select id={`${formId}-service`} aria-label="Servicio" value={serviceId} onValueChange={setServiceId}>
            <option value="">General (todos los servicios)</option>
            {activeServices.map(service => <option key={service.id} value={String(service.id)}>{service.name}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor={`${formId}-type`} className={labelClass}>Tipo</label>
          <Select id={`${formId}-type`} aria-label="Tipo" value={documentType} onValueChange={setDocumentType}>
            <option value="">Sin tipo</option>
            {DOCUMENT_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
          </Select>
        </div>
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <label htmlFor={`${formId}-content`} className={labelClass}>Contenido</label>
        <input ref={fileInput} type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" className="hidden" data-testid="knowledge-file" onChange={event => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }} />
        <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()} disabled={importPdf.isPending}>
          {importPdf.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
          {importPdf.isPending ? 'Leyendo PDF…' : 'Importar PDF, .txt o .md'}
        </Button>
      </div>
      <Textarea
        id={`${formId}-content`}
        rows={14}
        value={content}
        onChange={event => setContent(event.target.value)}
        maxLength={100_000}
        placeholder={'Qué es, para quién es, cuánto dura, cuidados, objeciones frecuentes y cómo responderlas…'}
        required
      />
      <p className="mt-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
        Separa los temas con títulos (## Tema) o con una línea en blanco: el asistente busca por sección. Un PDF escaneado no se puede leer: cópialo como texto.
        {' '}{content.length.toLocaleString('es-PE')} / 100.000 caracteres.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {documentId && (
          <ConfirmDialog
            title="Eliminar documento"
            description={`El asistente dejará de usar "${initial.title || title}". Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar"
            disabled={remove.isPending}
            onConfirm={() => remove.mutate(documentId, {
              onSuccess: () => { toast.success('Documento eliminado'); onDone(null) },
              onError: err => toast.error(extractErrorMessage(err)),
            })}
          >
            <Button variant="ghost" className="mr-auto text-red-600 hover:text-red-700 dark:text-red-300">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Eliminar
            </Button>
          </ConfirmDialog>
        )}
        <Button variant="secondary" onClick={() => onDone(documentId)}>Cancelar</Button>
        <Button type="submit" disabled={save.isPending || importPdf.isPending || !title.trim() || !content.trim()}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Guardar documento
        </Button>
      </div>
    </form>
  )
}

function matchesFilter(document: KnowledgeDocumentSummary, filter: string): boolean {
  if (filter === ALL) return true
  if (filter === GENERAL) return document.service_id == null
  return String(document.service_id) === filter
}

function typeLabel(key: string | null): string | undefined {
  return DOCUMENT_TYPES.find(type => type.key === key)?.label
}

/**
 * Con muchos documentos (las plantillas importadas suman ~20) el editor queda
 * arriba de la grilla y, al elegir uno del final de la lista, fuera de la
 * pantalla: parecía que el clic no abría nada. En móvil está debajo de la lista.
 */
function useRevealOnChange(value: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const element = ref.current
    if (value === null || !element) return
    const { top, bottom } = element.getBoundingClientRect()
    if (top < 0 || top > window.innerHeight || bottom < 0) element.scrollIntoView?.({ block: 'start', behavior: 'smooth' })
  }, [value])
  return ref
}

function DocumentListItem({ document, serviceName, selected, onSelect }: {
  document: KnowledgeDocumentSummary
  serviceName: string
  selected: boolean
  onSelect: () => void
}) {
  const type = typeLabel(document.document_type)
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-current={selected}
        className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${selected ? 'bg-wa-primary/10' : 'hover:bg-wa-hover dark:hover:bg-wa-head-dark'}`}
      >
        <FileText className="mt-0.5 h-4 w-4 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">{document.title}</span>
          <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">
            {serviceName}
            {type ? ` · ${type}` : ''}
            {document.template_id != null ? ' · desde plantilla' : ''}
            {' · '}{document.chunk_count} {document.chunk_count === 1 ? 'fragmento' : 'fragmentos'}
          </span>
        </span>
      </button>
    </li>
  )
}

function DocumentsListStatus({ isLoading, error, empty, filterServiceId }: {
  isLoading: boolean
  error: unknown
  empty: boolean
  filterServiceId: number | null
}) {
  if (isLoading) return <p className="mt-4 text-sm text-wa-muted dark:text-wa-muted-dark">Cargando…</p>
  if (error) return <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-300">{extractErrorMessage(error)}</p>
  if (!empty) return null
  return filterServiceId ? (
    <EmptyState
      icon={BookText}
      title="Este servicio no tiene documentos"
      description="Sube su ficha (PDF o texto) o importa una plantilla: el asistente la usará cuando un lead se interese en este servicio."
    />
  ) : (
    <EmptyState
      icon={BookText}
      title="Sin documentos"
      description="Carga fichas de servicios, políticas, preguntas frecuentes o guiones de venta, o importa una plantilla de la plataforma."
    />
  )
}

export function KnowledgePanel({ initialServiceId = null }: { initialServiceId?: number | null }) {
  const { data: documents = [], isLoading, error } = useKnowledgeDocuments()
  const services = useServiceNames()
  const [filter, setFilter] = useState<string>(initialServiceId ? String(initialServiceId) : ALL)
  // null = sin editor abierto; 'new' = alta; otro valor = id en edición.
  const [editing, setEditing] = useState<string | null>(null)
  const [browsingTemplates, setBrowsingTemplates] = useState(false)
  const editorRef = useRevealOnChange(editing)

  const visible = documents.filter(document => matchesFilter(document, filter))
  const filterServiceId = filter !== ALL && filter !== GENERAL ? Number(filter) : null
  // El servicio filtrado aparece aunque todavía no tenga documentos.
  const filterOptions = [...new Set([
    ...documents.map(document => document.service_id).filter((id): id is number => id != null),
    ...(filterServiceId ? [filterServiceId] : []),
  ])]
  const serviceNameOf = (id: number | null) => (id != null ? services.get(id)?.name ?? 'Servicio' : 'General')

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className={panelClass}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Documentos</h2>
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setBrowsingTemplates(true)}>
              <Library className="h-3.5 w-3.5" aria-hidden="true" />
              Plantillas
            </Button>
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Nuevo
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <Select aria-label="Filtrar por servicio" value={filter} onValueChange={setFilter}>
            <option value={ALL}>Todos los documentos</option>
            <option value={GENERAL}>Generales (sin servicio)</option>
            {filterOptions.map(id => (
              <option key={id} value={String(id)}>{services.get(id)?.name ?? `Servicio ${id}`}</option>
            ))}
          </Select>
        </div>
        <DocumentsListStatus isLoading={isLoading} error={error} empty={visible.length === 0} filterServiceId={filterServiceId} />
        <ul className="mt-3 space-y-1" aria-label="Documentos de conocimiento">
          {visible.map(document => (
            <DocumentListItem
              key={document.id}
              document={document}
              serviceName={serviceNameOf(document.service_id)}
              selected={editing === document.id}
              onSelect={() => setEditing(document.id)}
            />
          ))}
        </ul>
      </div>
      {editing === null ? (
        <div className={`${panelClass} hidden lg:block`}>
          <EmptyState icon={BookText} title="Elige un documento" description="O crea uno nuevo. El asistente consulta estos textos cuando necesita detalles de un servicio o una política." />
        </div>
      ) : (
        <div ref={editorRef} className="scroll-mt-4">
          <KnowledgeEditor
            key={editing}
            documentId={editing === 'new' ? null : editing}
            defaultServiceId={editing === 'new' ? filterServiceId : null}
            onDone={id => setEditing(id)}
          />
        </div>
      )}
      {browsingTemplates && (
        <KnowledgeTemplatesDialog
          preferredServiceId={filterServiceId}
          onClose={() => setBrowsingTemplates(false)}
          onImported={documentId => {
            setBrowsingTemplates(false)
            setFilter(ALL)
            setEditing(documentId)
          }}
        />
      )}
    </div>
  )
}
