import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookText, Loader2, Plus } from 'lucide-react'
import { useId, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input, Select, Textarea, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { fetchKnowledgeTemplates, saveKnowledgeTemplate } from '../api'
import { platformKeys } from '../keys'
import type { KnowledgeTemplate } from '../types'

const TYPES = [
  { key: 'ficha', label: 'Ficha del servicio' },
  { key: 'faq', label: 'Preguntas frecuentes' },
  { key: 'guion', label: 'Guion de venta u objeciones' },
  { key: 'politica', label: 'Política del negocio' },
  { key: 'otro', label: 'Otro' },
] as const

type TemplateType = (typeof TYPES)[number]['key']

function TemplateForm({ template, onDone }: { template: KnowledgeTemplate | null; onDone: () => void }) {
  const formId = useId()
  const queryClient = useQueryClient()
  const [title, setTitle] = useState(template?.title ?? '')
  const [documentType, setDocumentType] = useState<string>(template?.document_type ?? 'ficha')
  const [serviceHint, setServiceHint] = useState(template?.service_hint ?? '')
  const [content, setContent] = useState(template?.content ?? '')
  const [active, setActive] = useState(template?.is_active ?? true)
  const save = useMutation({
    mutationFn: saveKnowledgeTemplate,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: platformKeys.knowledgeTemplates })
      toast.success(template ? 'Plantilla actualizada: los negocios verán la nueva versión al importar' : 'Plantilla creada')
      onDone()
    },
    onError: err => toast.error(extractErrorMessage(err)),
  })

  return (
    <form
      className="mt-4 space-y-3 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark"
      onSubmit={event => {
        event.preventDefault()
        save.mutate({
          id: template?.id ?? null,
          title,
          document_type: (documentType || null) as TemplateType | null,
          service_hint: serviceHint.trim() || null,
          content,
          is_active: active,
        })
      }}
    >
      <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <label htmlFor={`${formId}-title`} className={labelClass}>Título</label>
          <Input id={`${formId}-title`} value={title} onChange={event => setTitle(event.target.value)} maxLength={200} placeholder="Ficha: Hollywood Peel" required />
        </div>
        <div>
          <label htmlFor={`${formId}-type`} className={labelClass}>Tipo</label>
          <Select id={`${formId}-type`} aria-label="Tipo de plantilla" value={documentType} onValueChange={setDocumentType}>
            {TYPES.map(type => <option key={type.key} value={type.key}>{type.label}</option>)}
          </Select>
        </div>
        <div>
          <label htmlFor={`${formId}-hint`} className={labelClass}>Servicio sugerido</label>
          <Input id={`${formId}-hint`} value={serviceHint} onChange={event => setServiceHint(event.target.value)} maxLength={120} placeholder="Hollywood Peel" />
        </div>
      </div>
      <div>
        <label htmlFor={`${formId}-content`} className={labelClass}>Contenido</label>
        <Textarea id={`${formId}-content`} rows={10} value={content} onChange={event => setContent(event.target.value)} maxLength={100_000} required
          placeholder="Qué es, para quién es, sesiones recomendadas, contraindicaciones, cuidados y objeciones frecuentes. Cada negocio la ajusta a su forma de trabajar." />
        <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">Los negocios importan una copia propia y la editan; cambiar esta plantilla no modifica las copias ya importadas.</p>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="flex items-center gap-2 text-sm text-wa-text dark:text-wa-text-dark">
          <Checkbox checked={active} onCheckedChange={checked => setActive(checked === true)} />
          Visible para los negocios
        </label>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onDone}>Cancelar</Button>
          <Button type="submit" disabled={save.isPending || !title.trim() || !content.trim()}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {template ? 'Guardar cambios' : 'Crear plantilla'}
          </Button>
        </div>
      </div>
    </form>
  )
}

/**
 * Biblioteca de fichas, preguntas frecuentes y guiones modelo que la
 * plataforma ofrece a todos los negocios para su asistente IA.
 */
export function KnowledgeTemplatesPanel() {
  const { data: templates = [], isLoading, error } = useQuery({ queryKey: platformKeys.knowledgeTemplates, queryFn: fetchKnowledgeTemplates })
  // null = sin formulario; 'new' = alta; número = edición.
  const [editing, setEditing] = useState<number | 'new' | null>(null)
  const typeLabel = (key: string | null) => TYPES.find(type => type.key === key)?.label ?? 'Sin tipo'

  return (
    <section className="mt-8 rounded-xl border border-wa-border bg-white p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark" aria-labelledby="plantillas-conocimiento">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 id="plantillas-conocimiento" className="flex items-center gap-2 text-lg font-bold text-wa-text dark:text-white">
            <BookText className="h-5 w-5 text-wa-primary" aria-hidden="true" />
            Plantillas de conocimiento
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-wa-muted dark:text-wa-muted-dark">
            Fichas de tratamientos, preguntas frecuentes y guiones que cada negocio puede importar en Asistente IA › Conocimiento y editar a su gusto.
          </p>
        </div>
        {editing === null && (
          <Button onClick={() => setEditing('new')}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Nueva plantilla
          </Button>
        )}
      </div>

      {editing === 'new' && <TemplateForm template={null} onDone={() => setEditing(null)} />}

      {isLoading && <p className="mt-4 text-sm text-wa-muted dark:text-wa-muted-dark">Cargando…</p>}
      {error && <p role="alert" className="mt-4 text-sm text-red-600 dark:text-red-300">{extractErrorMessage(error)}</p>}
      {!isLoading && !error && templates.length === 0 && editing !== 'new' && (
        <p className="mt-4 rounded-lg border border-dashed border-wa-border p-6 text-center text-sm text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
          Todavía no hay plantillas. Crea la primera, por ejemplo la ficha del Hollywood Peel.
        </p>
      )}
      <ul className="mt-4 space-y-2" aria-label="Plantillas de conocimiento">
        {templates.map(template => (
          <li key={template.id} className="rounded-lg border border-wa-border/70 p-3 dark:border-wa-border-dark/70">
            {editing === template.id ? (
              <TemplateForm template={template} onDone={() => setEditing(null)} />
            ) : (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                    {template.title}
                    {!template.is_active && <span className="ml-2 rounded bg-wa-field px-1.5 py-0.5 text-[11px] font-medium text-wa-muted dark:bg-wa-field-dark">Oculta</span>}
                  </p>
                  <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                    {typeLabel(template.document_type)}
                    {template.service_hint ? ` · ${template.service_hint}` : ''}
                    {` · versión ${template.version} · ${template.content.length.toLocaleString('es-PE')} caracteres`}
                  </p>
                </div>
                <Button variant="secondary" size="sm" className="h-9" onClick={() => setEditing(template.id)} aria-label={`Editar plantilla ${template.title}`}>Editar</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}
