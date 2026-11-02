/**
 * Lo que el asistente IA sabe del negocio.
 *
 * El negocio no configura workflows, modelos ni URLs: eso lo opera la
 * plataforma. Acá solo carga su perfil, sus documentos de conocimiento y qué
 * archivos de su biblioteca puede proponer el asistente como adjuntos. Los
 * precios viven en Catálogos > Servicios, junto al resto del catálogo.
 */
import { BookText, Building2, FileText, FolderOpen, Loader2, Plus, Sparkles, Trash2, Upload } from 'lucide-react'
import { useEffect, useId, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Input, Textarea, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMediaLibrary } from '../../media/public/queries'
import type { MediaAsset } from '../../media/types'
import {
useAiProfile,
useAiUsage,
useDeleteKnowledgeDocument,
useKnowledgeDocument,
useKnowledgeDocuments,
useSaveAiProfile,
useSaveKnowledgeDocument,
useSetAiResourceDescription,
} from '../queries'
import type { AIProfile } from '../types'

type Tab = 'profile' | 'knowledge' | 'resources'

const TABS: readonly { key: Tab; label: string; icon: typeof Sparkles }[] = [
  { key: 'profile', label: 'Perfil del negocio', icon: Building2 },
  { key: 'knowledge', label: 'Conocimiento', icon: BookText },
  { key: 'resources', label: 'Adjuntos', icon: FolderOpen },
]

const tabClass = (active: boolean) =>
  `inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-semibold outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-wa-primary/60 sm:min-h-9 ${
    active
      ? 'bg-wa-primary/12 text-wa-primary-strong dark:bg-wa-primary/20 dark:text-wa-primary'
      : 'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
  }`

const panelClass = 'rounded-xl border border-wa-border bg-white p-4 sm:p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark'

// Mismos topes que valida el backend (services/ai_assistant_service.py).
const PROFILE_FIELDS: readonly {
  key: keyof Omit<AIProfile, 'updated_at'>
  label: string
  hint?: string
  placeholder: string
  maxLength: number
  multiline?: boolean
}[] = [
  { key: 'business_name', label: 'Nombre del negocio', placeholder: 'Clínica Norte', maxLength: 120 },
  { key: 'currency', label: 'Moneda de los precios', hint: 'Código de 3 letras', placeholder: 'PEN', maxLength: 10 },
  { key: 'business_description', label: 'Qué ofrece el negocio', placeholder: 'Clínica dermoestética con tratamientos faciales y corporales…', maxLength: 2000, multiline: true },
  { key: 'location', label: 'Ubicación', placeholder: 'Av. Principal 123, Miraflores. Estacionamiento gratuito.', maxLength: 500, multiline: true },
  { key: 'opening_hours', label: 'Horarios de atención', placeholder: 'Lunes a sábado de 9:00 a 19:00', maxLength: 500, multiline: true },
  { key: 'tone', label: 'Tono de los mensajes', placeholder: 'Cercano y profesional, tuteando al cliente', maxLength: 300 },
  { key: 'always_rules', label: 'El asistente siempre debe…', hint: 'Una regla por línea', placeholder: 'Ofrecer la evaluación gratuita\nPreguntar el nombre si no lo tenemos', maxLength: 2000, multiline: true },
  { key: 'never_rules', label: 'El asistente nunca debe…', hint: 'Una regla por línea', placeholder: 'Dar diagnósticos\nPrometer resultados', maxLength: 2000, multiline: true },
]

const EMPTY_PROFILE: Omit<AIProfile, 'updated_at'> = {
  business_name: null,
  business_description: null,
  location: null,
  opening_hours: null,
  currency: null,
  tone: null,
  always_rules: null,
  never_rules: null,
}

function UsageBanner() {
  const { data } = useAiUsage()
  if (!data) return null
  if (!data.enabled) {
    return (
      <p role="status" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-800 dark:text-amber-200">
        El asistente IA no está incluido en el plan de tu negocio. Puedes dejar todo preparado; las sugerencias se activarán cuando la plataforma lo habilite.
      </p>
    )
  }
  if (data.monthly_quota === null) {
    return <p className="mt-4 text-sm text-wa-muted dark:text-wa-muted-dark">{data.used_this_month} sugerencias generadas este mes · sin límite mensual.</p>
  }
  const percent = data.monthly_quota > 0 ? Math.min(100, Math.round((data.used_this_month / data.monthly_quota) * 100)) : 100
  return (
    <div className="mt-4 max-w-md">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-wa-text dark:text-wa-text-dark">{data.used_this_month} de {data.monthly_quota} sugerencias este mes</span>
        <span className="text-xs text-wa-muted dark:text-wa-muted-dark">Quedan {data.remaining}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wa-field dark:bg-wa-field-dark" role="progressbar" aria-valuenow={data.used_this_month} aria-valuemin={0} aria-valuemax={data.monthly_quota} aria-label="Uso mensual del asistente">
        <div className={`h-full rounded-full ${percent >= 90 ? 'bg-amber-500' : 'bg-wa-primary'}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function ProfilePanel() {
  const formId = useId()
  const { data, isLoading, error } = useAiProfile()
  const save = useSaveAiProfile()
  const [draft, setDraft] = useState<Omit<AIProfile, 'updated_at'>>(EMPTY_PROFILE)

  useEffect(() => {
    if (!data) return
    const { updated_at: _updatedAt, ...values } = data
    setDraft(values)
  }, [data])

  if (isLoading) return <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Cargando perfil…</p>
  if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-300">{extractErrorMessage(error)}</p>

  return (
    <form
      className={panelClass}
      onSubmit={event => {
        event.preventDefault()
        save.mutate(draft, {
          onSuccess: () => toast.success('Perfil guardado'),
          onError: err => toast.error(extractErrorMessage(err)),
        })
      }}
    >
      <p className="text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
        El asistente usa estos datos para presentar tu negocio y redactar las sugerencias con tu estilo. Deja vacío lo que no aplique: nunca inventa lo que falta.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {PROFILE_FIELDS.map(field => {
          const inputId = `${formId}-${field.key}`
          const value = draft[field.key] ?? ''
          const common = {
            id: inputId,
            value,
            maxLength: field.maxLength,
            placeholder: field.placeholder,
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              setDraft(current => ({ ...current, [field.key]: event.target.value })),
          }
          return (
            <div key={field.key} className={field.multiline ? 'md:col-span-2' : undefined}>
              <label htmlFor={inputId} className={labelClass}>
                {field.label}
                {field.hint && <span className="font-normal"> · {field.hint}</span>}
              </label>
              {field.multiline ? <Textarea rows={3} {...common} /> : <Input {...common} />}
            </div>
          )
        })}
      </div>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
          Los precios se cargan en <Link to="/catalogs" className="font-semibold text-wa-primary-strong hover:underline dark:text-wa-primary">Catálogos › Servicios</Link>.
        </p>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Guardar perfil
        </Button>
      </div>
    </form>
  )
}

function KnowledgeEditor({ documentId, onDone }: { documentId: string | null; onDone: (id: string | null) => void }) {
  const formId = useId()
  const fileInput = useRef<HTMLInputElement>(null)
  const { data, isLoading } = useKnowledgeDocument(documentId)
  const save = useSaveKnowledgeDocument()
  const remove = useDeleteKnowledgeDocument()
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  useEffect(() => {
    setTitle(data?.title ?? '')
    setContent(data?.content ?? '')
  }, [data, documentId])

  async function importFile(file: File) {
    const text = await file.text()
    setContent(text)
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ''))
  }

  if (documentId && isLoading) return <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Cargando documento…</p>

  return (
    <form
      className={panelClass}
      onSubmit={event => {
        event.preventDefault()
        save.mutate({ id: documentId, title, content }, {
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
      <div className="mt-4 flex items-end justify-between gap-2">
        <label htmlFor={`${formId}-content`} className={labelClass}>Contenido</label>
        <input ref={fileInput} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={event => {
          const file = event.target.files?.[0]
          if (file) void importFile(file)
          event.target.value = ''
        }} />
        <Button variant="ghost" size="sm" onClick={() => fileInput.current?.click()}>
          <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          Importar .txt o .md
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
        Separa los temas con una línea en blanco: el asistente busca por párrafos. {content.length.toLocaleString('es-PE')} / 100.000 caracteres.
      </p>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
        {documentId && (
          <ConfirmDialog
            title="Eliminar documento"
            description={`El asistente dejará de usar "${data?.title ?? title}". Esta acción no se puede deshacer.`}
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
        <Button type="submit" disabled={save.isPending || !title.trim() || !content.trim()}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Guardar documento
        </Button>
      </div>
    </form>
  )
}

function KnowledgePanel() {
  const { data: documents = [], isLoading, error } = useKnowledgeDocuments()
  // null = sin editor abierto; 'new' = alta; otro valor = id en edición.
  const [editing, setEditing] = useState<string | null>(null)

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_minmax(0,1fr)]">
      <div className={panelClass}>
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Documentos</h2>
          <Button size="sm" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            Nuevo
          </Button>
        </div>
        {isLoading && <p className="mt-4 text-sm text-wa-muted dark:text-wa-muted-dark">Cargando…</p>}
        {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-300">{extractErrorMessage(error)}</p>}
        {!isLoading && !error && documents.length === 0 && (
          <EmptyState icon={BookText} title="Sin documentos" description="Carga fichas de servicios, políticas, preguntas frecuentes o guiones de venta." />
        )}
        <ul className="mt-3 space-y-1">
          {documents.map(document => (
            <li key={document.id}>
              <button
                type="button"
                onClick={() => setEditing(document.id)}
                aria-current={editing === document.id}
                className={`flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${editing === document.id ? 'bg-wa-primary/10' : 'hover:bg-wa-hover dark:hover:bg-wa-head-dark'}`}
              >
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">{document.title}</span>
                  <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">
                    {document.characters.toLocaleString('es-PE')} caracteres · {document.chunk_count} {document.chunk_count === 1 ? 'fragmento' : 'fragmentos'}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      {editing === null ? (
        <div className={`${panelClass} hidden lg:block`}>
          <EmptyState icon={BookText} title="Elige un documento" description="O crea uno nuevo. El asistente consulta estos textos cuando necesita detalles de un servicio o una política." />
        </div>
      ) : (
        <KnowledgeEditor
          key={editing}
          documentId={editing === 'new' ? null : editing}
          onDone={id => setEditing(id)}
        />
      )}
    </div>
  )
}

function ResourceRow({ asset }: { asset: MediaAsset }) {
  const [description, setDescription] = useState(asset.ai_description ?? '')
  const save = useSetAiResourceDescription()
  const changed = description.trim() !== (asset.ai_description ?? '')

  useEffect(() => setDescription(asset.ai_description ?? ''), [asset.ai_description])

  return (
    <li className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 sm:w-56">
        <p className="truncate text-sm font-medium text-wa-text dark:text-wa-text-dark" title={asset.filename}>{asset.filename}</p>
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
          {asset.ai_description ? 'El asistente puede proponerlo' : 'Oculto para el asistente'}
        </p>
      </div>
      <Input
        value={description}
        onChange={event => setDescription(event.target.value)}
        maxLength={500}
        placeholder="Cuándo conviene enviarlo, ej. Promo de octubre de limpieza facial"
        aria-label={`Descripción para el asistente de ${asset.filename}`}
        className="flex-1"
      />
      <Button
        variant="secondary"
        size="sm"
        disabled={!changed || save.isPending}
        onClick={() => save.mutate({ id: asset.id, description }, {
          onSuccess: () => toast.success(description.trim() ? 'Adjunto disponible para el asistente' : 'Adjunto oculto para el asistente'),
          onError: err => toast.error(extractErrorMessage(err)),
        })}
      >
        {save.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
        Guardar
      </Button>
    </li>
  )
}

function ResourcesPanel() {
  const { data: assets = [], isLoading, error } = useMediaLibrary()
  const described = assets.filter(asset => asset.ai_description).length

  return (
    <div className={panelClass}>
      <p className="text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
        Describe los archivos de tu biblioteca que el asistente puede sugerir adjuntar (flyers, catálogos, videos). Sin descripción no los ve. Para subir archivos nuevos ve a{' '}
        <Link to="/media-library" className="font-semibold text-wa-primary-strong hover:underline dark:text-wa-primary">Archivos</Link>.
      </p>
      {isLoading && <p className="mt-4 text-sm text-wa-muted dark:text-wa-muted-dark">Cargando archivos…</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-300">{extractErrorMessage(error)}</p>}
      {!isLoading && !error && assets.length === 0 && (
        <EmptyState icon={FolderOpen} title="La biblioteca está vacía" description="Sube archivos en la sección Archivos para poder ofrecérselos al asistente." />
      )}
      {assets.length > 0 && (
        <>
          <p className="mt-4 text-xs font-medium text-wa-muted dark:text-wa-muted-dark">{described} de {assets.length} archivos disponibles para el asistente</p>
          <ul className="mt-1 divide-y divide-wa-border dark:divide-wa-border-dark">
            {assets.map(asset => <ResourceRow key={asset.id} asset={asset} />)}
          </ul>
        </>
      )}
    </div>
  )
}

export function AiAssistantPage() {
  const [tab, setTab] = useState<Tab>('profile')

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-wa-text dark:text-white">Asistente IA</h1>
          <p className="mt-1.5 max-w-prose text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            Lo que el asistente sabe de tu negocio para sugerir respuestas a tu equipo.
          </p>
          <UsageBanner />
          <div
            role="group"
            aria-label="Secciones del asistente"
            className="mt-5 flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-wa-border bg-white p-1 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:w-fit"
          >
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key} className={tabClass(tab === key)}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </header>

        <section aria-label={TABS.find(item => item.key === tab)?.label} className="mt-5">
          {tab === 'profile' ? <ProfilePanel /> : tab === 'knowledge' ? <KnowledgePanel /> : <ResourcesPanel />}
        </section>
      </main>
    </div>
  )
}
