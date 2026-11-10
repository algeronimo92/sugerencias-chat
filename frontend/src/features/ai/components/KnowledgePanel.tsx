import { ArrowLeft, BookText, Check, Library, Loader2, Plus, Trash2, Upload } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Input, Select, Textarea, labelClass } from '../../../shared/ui/Input'
import { ServiceChecklist } from './ServiceChecklist'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useLeadServices } from '../../catalogs/public/useLeadServices'
import { familyMembers } from '../domain/serviceFamilies'
import {
  useDeleteKnowledgeDocument,
  useKnowledgeDocument,
  useKnowledgeDocuments,
  useSaveKnowledgeDocument,
} from '../queries'
import { MAX_CONTENT, useKnowledgeImport } from '../hooks/useKnowledgeImport'
import type { KnowledgeDocumentSummary, KnowledgeDocumentType } from '../types'
import { DocumentListItem, DocumentsListStatus } from './KnowledgeDocumentsList'
import { KnowledgeTemplatesDialog } from './KnowledgeTemplatesDialog'
import { panelClass } from './styles'

/**
 * Lo que el copiloto consulta para responder dudas, describir servicios y
 * manejar objeciones. Cada documento puede pertenecer a uno o varios servicios
 * del catálogo: cuando un lead se interesa en uno de ellos, sus fichas entran
 * primero a la sugerencia. Sin servicio sirve para todos (pagos, garantías,
 * ubicación).
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
const GENERAL_LABEL = 'Para todos los servicios'

function useServiceNames() {
  const { data: services = [] } = useLeadServices(true)
  return useMemo(() => new Map(services.map(service => [service.id, service])), [services])
}

function sameIds(left: number[], right: number[]): boolean {
  const rightSet = new Set(right)
  return left.length === right.length && left.every(id => rightSet.has(id))
}

interface FormValues { title: string; content: string; documentType: string; serviceIds: number[] }

interface EditorProps {
  documentId: string | null
  /** Con qué servicios nace un documento nuevo (la familia del servicio desde el que se llegó). */
  defaultServiceIds: number[]
  dirtyRef: MutableRefObject<boolean>
  onSaved: (id: string) => void
  onCancel: () => void
  onDeleted: () => void
}

function KnowledgeEditor({ documentId, defaultServiceIds, ...rest }: EditorProps) {
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
        serviceIds: data ? data.service_ids : defaultServiceIds,
      }}
      {...rest}
    />
  )
}

function KnowledgeForm({ documentId, initial, dirtyRef, onSaved, onCancel, onDeleted }: Omit<EditorProps, 'defaultServiceIds'> & { initial: FormValues }) {
  const formId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const services = useServiceNames()
  const save = useSaveKnowledgeDocument()
  const remove = useDeleteKnowledgeDocument()
  const [title, setTitle] = useState(initial.title)
  const [content, setContent] = useState(initial.content)
  const [documentType, setDocumentType] = useState<string>(initial.documentType)
  const [serviceIds, setServiceIds] = useState<number[]>(initial.serviceIds)
  const importer = useKnowledgeImport((text, suggestedTitle) => {
    setContent(text)
    setTitle(current => (current.trim() ? current : suggestedTitle))
  })

  // Cambios sin guardar: el panel los consulta antes de cambiar de documento
  // y el navegador avisa antes de cerrar la pestaña. Antes se perdían sin más
  // al tocar otra fila de la lista (2026-11-09).
  const dirty = title !== initial.title || content !== initial.content
    || documentType !== initial.documentType || !sameIds(serviceIds, initial.serviceIds)
  useEffect(() => {
    dirtyRef.current = dirty
    return () => { dirtyRef.current = false }
  }, [dirty, dirtyRef])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const overLimit = content.length > MAX_CONTENT

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
          service_ids: serviceIds,
        }, {
          onSuccess: saved => {
            dirtyRef.current = false
            toast.success(documentId ? 'Documento actualizado' : 'Documento creado')
            onSaved(saved.id)
          },
          onError: err => toast.error(extractErrorMessage(err)),
        })
      }}
    >
      <h2 className="mb-3 text-sm font-semibold text-wa-text dark:text-wa-text-dark">{documentId ? 'Editar documento' : 'Nuevo documento'}</h2>
      <label htmlFor={`${formId}-title`} className={labelClass}>Título</label>
      <Input id={`${formId}-title`} value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Ficha: limpieza facial profunda" required />

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <div>
          <label htmlFor={`${formId}-type`} className={labelClass}>Tipo</label>
          <Select id={`${formId}-type`} aria-label="Tipo" value={documentType} onValueChange={setDocumentType}>
            <option value="">Sin tipo</option>
            {DOCUMENT_TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
          </Select>
        </div>
        <ServiceChecklist services={[...services.values()]} selected={serviceIds} onChange={setServiceIds} />
      </div>

      <div className="mt-4 flex items-end justify-between gap-2">
        <label htmlFor={`${formId}-content`} className={labelClass}>Contenido</label>
        <input ref={fileInput} type="file" accept=".txt,.md,.pdf,text/plain,text/markdown,application/pdf" className="hidden" data-testid="knowledge-file" onChange={event => {
          const file = event.target.files?.[0]
          if (file) void importer.importFile(file)
          event.target.value = ''
        }} />
        <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()} disabled={importer.isPending}>
          {importer.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Upload className="h-3.5 w-3.5" aria-hidden="true" />}
          {importer.isPending ? 'Leyendo PDF…' : 'Importar PDF, .txt o .md'}
        </Button>
      </div>
      <Textarea
        id={`${formId}-content`}
        rows={14}
        value={content}
        onChange={event => setContent(event.target.value)}
        maxLength={MAX_CONTENT}
        placeholder={'Qué es, para quién es, cuánto dura, cuidados, objeciones frecuentes y cómo responderlas…'}
        required
      />
      <p className="mt-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
        Separa los temas con títulos (## Tema) o con una línea en blanco: el asistente busca por sección. Un PDF escaneado no se puede leer: cópialo como texto.
      </p>
      <p className={`mt-1 text-xs ${overLimit ? 'font-semibold text-red-600 dark:text-red-300' : 'text-wa-muted dark:text-wa-muted-dark'}`}>
        {content.length.toLocaleString('es-PE')} / 100.000 caracteres{overLimit ? ' · acorta el texto para poder guardar' : ''}
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {documentId && (
          <ConfirmDialog
            title="Eliminar documento"
            description={`El asistente dejará de usar "${initial.title || title}". Esta acción no se puede deshacer.`}
            confirmLabel="Eliminar"
            disabled={remove.isPending}
            onConfirm={() => remove.mutate(documentId, {
              onSuccess: () => { dirtyRef.current = false; toast.success('Documento eliminado'); onDeleted() },
              onError: err => toast.error(extractErrorMessage(err)),
            })}
          >
            <Button variant="ghost" className="mr-auto text-red-600 hover:text-red-700 dark:text-red-300">
              <Trash2 className="h-4 w-4" aria-hidden="true" />
              Eliminar
            </Button>
          </ConfirmDialog>
        )}
        {/* El botón dice en qué estado está el documento: antes decía siempre
            «Guardar documento» y no se sabía si lo editado ya estaba guardado. */}
        {dirty && !save.isPending && (
          <span role="status" className="text-xs text-amber-700 dark:text-amber-300">Cambios sin guardar</span>
        )}
        <Button variant="secondary" onClick={onCancel}>Cancelar</Button>
        <Button type="submit" disabled={save.isPending || importer.isPending || !title.trim() || !content.trim() || overLimit || (!!documentId && !dirty)}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          {!save.isPending && documentId && !dirty && <Check className="h-4 w-4" aria-hidden="true" />}
          {save.isPending ? 'Guardando…' : documentId ? (dirty ? 'Guardar cambios' : 'Guardado') : 'Guardar documento'}
        </Button>
      </div>
    </form>
  )
}

function matchesFilter(document: KnowledgeDocumentSummary, filter: string): boolean {
  if (filter === ALL) return true
  if (filter === GENERAL) return document.service_ids.length === 0
  return document.service_ids.includes(Number(filter))
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

/** `undefined`: sin cambio pendiente; `null` o un id: a dónde quería ir la usuaria. */
type Pending = string | null | undefined

export function KnowledgePanel({ initialServiceId = null }: { initialServiceId?: number | null }) {
  const { data: documents = [], isLoading, error, refetch } = useKnowledgeDocuments()
  const services = useServiceNames()
  const [filter, setFilter] = useState<string>(initialServiceId ? String(initialServiceId) : ALL)
  // null = sin editor abierto; 'new' = alta; otro valor = id en edición.
  const [editing, setEditing] = useState<string | null>(null)
  const [formKey, setFormKey] = useState(0)
  const [pending, setPending] = useState<Pending>(undefined)
  const [browsingTemplates, setBrowsingTemplates] = useState(false)
  const dirtyRef = useRef(false)
  const editorRef = useRevealOnChange(editing)

  // Cambiar de documento con cambios sin guardar pide confirmación.
  function requestEditing(next: string | null) {
    if (dirtyRef.current) { setPending(next); return }
    goTo(next)
  }
  function goTo(next: string | null) {
    dirtyRef.current = false
    if (next === editing) setFormKey(key => key + 1)
    setEditing(next)
  }

  const visible = documents.filter(document => matchesFilter(document, filter))
  const filterServiceId = filter !== ALL && filter !== GENERAL ? Number(filter) : null
  // Todos los servicios activos (también los que aún no tienen documentos:
  // así se ve cuáles faltan) más los inactivos que todavía tengan alguno.
  const withDocuments = new Set(documents.flatMap(document => document.service_ids))
  const filterOptions = [...services.values()]
    .filter(service => service.is_active !== false || withDocuments.has(service.id) || service.id === filterServiceId)
    .sort((left, right) => left.name.localeCompare(right.name, 'es'))
  const serviceNamesOf = (ids: number[]) => (ids.length ? ids.map(id => services.get(id)?.name ?? 'Servicio').join(', ') : GENERAL_LABEL)

  return (
    // `grid-cols-1`: sin ella la columna tomaba el ancho mínimo de los títulos
    // (411 px) y en un teléfono de 390 "Nuevo" y los campos quedaban cortados.
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className={`${panelClass} min-w-0`}>
        {initialServiceId && (
          <Link to="/catalogs" className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-wa-primary-strong hover:underline dark:text-wa-primary">
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Volver a Catálogos
          </Link>
        )}
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Documentos</h2>
          <div className="flex items-center gap-1.5">
            <Button variant="secondary" size="sm" onClick={() => setBrowsingTemplates(true)}>
              <Library className="h-3.5 w-3.5" aria-hidden="true" />
              Plantillas
            </Button>
            <Button size="sm" onClick={() => requestEditing('new')}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Nuevo
            </Button>
          </div>
        </div>
        <div className="mt-3">
          <Select aria-label="Filtrar por servicio" value={filter} onValueChange={setFilter}>
            <option value={ALL}>Todos los documentos</option>
            <option value={GENERAL}>{GENERAL_LABEL}</option>
            {filterOptions.map(service => (
              <option key={service.id} value={String(service.id)}>{service.name}{withDocuments.has(service.id) ? '' : ' · sin documentos'}</option>
            ))}
          </Select>
        </div>
        <DocumentsListStatus isLoading={isLoading} error={error} empty={visible.length === 0} filterServiceId={filterServiceId} onRetry={() => void refetch()} />
        <ul className="mt-3 space-y-1" aria-label="Documentos de conocimiento">
          {visible.map(document => (
            <DocumentListItem
              key={document.id}
              document={document}
              serviceName={serviceNamesOf(document.service_ids)}
              typeName={typeLabel(document.document_type)}
              selected={editing === document.id}
              onSelect={() => requestEditing(document.id)}
            />
          ))}
        </ul>
      </div>
      {editing === null ? (
        <div className={`${panelClass} hidden lg:block`}>
          <EmptyState icon={BookText} title="Elige un documento" description="O crea uno nuevo. El asistente consulta estos textos cuando necesita detalles de un servicio o una política." />
        </div>
      ) : (
        <div ref={editorRef} className="min-w-0 scroll-mt-4">
          <KnowledgeEditor
            key={`${editing}:${formKey}`}
            documentId={editing === 'new' ? null : editing}
            defaultServiceIds={editing === 'new' && filterServiceId ? familyMembers([...services.values()], filterServiceId) : []}
            dirtyRef={dirtyRef}
            onSaved={id => goTo(id)}
            onCancel={() => requestEditing(editing === 'new' ? null : editing)}
            onDeleted={() => goTo(null)}
          />
        </div>
      )}
      <ConfirmDialog
        open={pending !== undefined}
        onOpenChange={open => { if (!open) setPending(undefined) }}
        title="Tienes cambios sin guardar"
        description="Si sales ahora, se pierden los cambios de este documento."
        confirmLabel="Descartar cambios"
        cancelLabel="Seguir editando"
        onConfirm={() => { goTo(pending ?? null); setPending(undefined) }}
      />
      {browsingTemplates && (
        <KnowledgeTemplatesDialog
          preferredServiceId={filterServiceId}
          onClose={() => setBrowsingTemplates(false)}
          onOpenDocument={documentId => {
            setBrowsingTemplates(false)
            setFilter(ALL)
            requestEditing(documentId)
          }}
        />
      )}
    </div>
  )
}
