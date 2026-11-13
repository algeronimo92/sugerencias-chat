import { BellRing, CalendarCheck, Check, Loader2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { IntegrationCard, IntegrationDisclosure } from '../../../shared/ui/IntegrationCard'
import { Select, fieldClass, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { parseLine, serializeLine, type PieceDraft as TemplateDraft } from '../../../shared/pieces'
import { pieceLabels, previewNotice, renderParameter, templateVariables } from '../domain/notice'
import { useNotice, useSaveNotice } from '../queries'
import type { NoticeAudience, NoticeSettings } from '../types'
import { VariablesBuilder, type VariableFieldGroup } from '../../../shared/ui/VariablesBuilder'

const COPY = {
  client: {
    id: 'aviso-cita-cliente',
    icon: CalendarCheck,
    title: 'Aviso de cita al cliente',
    description: 'Al guardar una cita, el cliente recibe por WhatsApp una plantilla oficial con los datos de su cita, en el chat de su lead.',
    toggle: 'Avisar al cliente cuando se guarda una cita',
    previewLabel: 'Así le llega al cliente',
    previewHint: 'Solo sale si la cita está vinculada a un lead. Una variable cuyos datos están vacíos sale como "-". Las citas de prueba nunca avisan.',
  },
  staff: {
    id: 'aviso-cita-equipo',
    icon: BellRing,
    title: 'Aviso de venta al equipo',
    description: 'Al guardar una cita, el responsable y los admins reciben por WhatsApp una plantilla oficial con la venta, en el número cargado en Usuarios. También se enteran en la app.',
    toggle: 'Avisar al equipo cuando se guarda una cita',
    previewLabel: 'Así le llega al equipo',
    previewHint: 'Solo le llega a quien tiene teléfono cargado en Usuarios. Una variable cuyos datos están vacíos sale como "-". Las citas de prueba nunca avisan.',
  },
} as const

/** Tarjeta de Integraciones para configurar un aviso de cita por WhatsApp. */
export function NoticeCard({ audience }: { audience: NoticeAudience }) {
  const copy = COPY[audience]
  const { data, isLoading, isError } = useNotice(audience)
  return (
    <IntegrationCard
      id={copy.id}
      icon={copy.icon}
      title={copy.title}
      description={copy.description}
      state={data?.enabled ? 'connected' : 'unconfigured'}
      stateLabel={data?.enabled ? 'Activo' : 'Apagado'}
    >
      {isLoading ? (
        <Loader2 className="mx-auto h-4 w-4 animate-spin text-wa-muted" aria-label="Cargando aviso" />
      ) : isError || !data ? (
        <p className="text-xs text-red-500 dark:text-red-400">No se pudo cargar el aviso.</p>
      ) : (
        <NoticeForm audience={audience} settings={data} />
      )}
    </IntegrationCard>
  )
}

const GROUPS = [
  { id: 'cita', label: 'De la cita' },
  { id: 'cita_personalizado', label: 'Campos de la cita' },
  { id: 'lead', label: 'Del lead' },
  { id: 'lead_personalizado', label: 'Campos del lead' },
]

function groupsOf(fields: NoticeSettings['fields']): VariableFieldGroup[] {
  return GROUPS.map(group => ({ ...group, fields: fields.filter(field => field.group === group.id) }))
}

/** Lo que el aviso guardó para esta plantilla o, si no hay nada, lo que se
 *  armó para sus variables en Plantillas: nunca se empieza de cero. */
function startingParameters(settings: NoticeSettings, template: NoticeSettings['templates'][number] | null): string[] {
  if (!template) return []
  if (template.id === settings.template_id && settings.parameters.some(Boolean)) return settings.parameters
  return template.suggested_parameters
}

function slotsOf(template: NoticeSettings['templates'][number] | null): string[] {
  if (!template) return []
  const names = templateVariables(template.content)
  const count = Math.max(template.variable_count, names.length)
  return Array.from({ length: count }, (_, index) => names[index] ?? String(index + 1))
}

function draftOf(parameters: string[], count: number, knownKeys: Set<string>): TemplateDraft {
  return { title: [], lines: Array.from({ length: count }, (_, index) => parseLine(parameters[index] ?? '', knownKeys)) }
}

function NoticeForm({ audience, settings }: { audience: NoticeAudience; settings: NoticeSettings }) {
  const copy = COPY[audience]
  const save = useSaveNotice(audience)
  const knownKeys = useMemo(() => new Set(settings.fields.map(field => field.key)), [settings.fields])
  const labels = useMemo(() => pieceLabels(settings.fields), [settings.fields])
  const [enabled, setEnabled] = useState(settings.enabled)
  const [configurationOpen, setConfigurationOpen] = useState(false)
  const [templateId, setTemplateId] = useState<number | null>(settings.template_id ?? null)
  const initialTemplate = settings.templates.find(item => item.id === settings.template_id) ?? null
  const [draft, setDraft] = useState<TemplateDraft>(
    () => draftOf(startingParameters(settings, initialTemplate), slotsOf(initialTemplate).length, knownKeys),
  )

  const template = settings.templates.find(item => item.id === templateId) ?? null
  const variables = slotsOf(template)
  const parameters = draft.lines.map(serializeLine)
  const values = settings.preview?.values
  const rendered = parameters.map(parameter => (parameter ? renderParameter(parameter, labels, values) : ''))
  const complete = template !== null && parameters.length === variables.length && parameters.every(Boolean)
  const dirty = enabled !== settings.enabled
    || templateId !== (settings.template_id ?? null)
    || parameters.join('|') !== settings.parameters.join('|')

  const change = (apply: () => void) => {
    save.reset()
    apply()
  }

  const chooseTemplate = (value: string) => change(() => {
    const id = value ? Number(value) : null
    const next = settings.templates.find(item => item.id === id) ?? null
    setTemplateId(id)
    setDraft(draftOf(startingParameters(settings, next), slotsOf(next).length, knownKeys))
  })

  if (settings.templates.length === 0) {
    return (
      <p className="text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
        Para activarlo, crea en Plantillas una plantilla oficial de categoría Utilidad, visible para todo el equipo, y espera a que Meta la apruebe. Luego vuelve aquí para elegirla.
      </p>
    )
  }

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-wa-text dark:text-wa-text-dark">
        <Checkbox checked={enabled} onCheckedChange={value => change(() => setEnabled(value))} disabled={save.isPending} />
        {copy.toggle}
      </label>

      <IntegrationDisclosure
        id={`${audience}-notice-configuration`}
        title="Configuración del aviso"
        open={configurationOpen}
        onToggle={() => setConfigurationOpen(current => !current)}
      >
        <div className="space-y-4">
          <div>
            <label htmlFor={`${audience}-notice-template`} className={labelClass}>Plantilla oficial</label>
            <Select id={`${audience}-notice-template`} value={templateId ?? ''} onValueChange={chooseTemplate} disabled={save.isPending} className={fieldClass}>
              <option value="">Elige una plantilla aprobada</option>
              {settings.templates.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
            </Select>
          </div>

          {template && variables.length > 0 && (
            <VariablesBuilder
              groups={groupsOf(settings.fields)}
              labels={labels}
              variables={variables}
              draft={draft}
              rendered={rendered}
              renderedLabel={settings.preview ? 'Con la última cita' : 'Se verá'}
              disabled={save.isPending}
              onChange={next => change(() => setDraft(next))}
            />
          )}

          {template && (
            <div>
              <p className={labelClass}>{copy.previewLabel}</p>
              <p className="mb-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
                {settings.preview
                  ? `Con los datos de la última cita: ${settings.preview.label}`
                  : 'Todavía no hay citas: cada dato se muestra por su nombre.'}
              </p>
              <p className="whitespace-pre-wrap rounded-lg bg-wa-field px-3 py-2 text-sm text-wa-text dark:bg-wa-field-dark dark:text-wa-text-dark">
                {previewNotice(template.content, rendered)}
              </p>
              <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
                {copy.previewHint}
              </p>
            </div>
          )}
        </div>
      </IntegrationDisclosure>

      <div className="flex flex-wrap items-center justify-end gap-3">
        {save.isError && (
          <p role="alert" className="text-xs text-red-500 dark:text-red-400">{extractErrorMessage(save.error)}</p>
        )}
        {save.isSuccess && !dirty && (
          <p role="status" className="inline-flex items-center gap-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Guardado
          </p>
        )}
        <Button
          size="sm"
          disabled={!dirty || save.isPending || (enabled && !complete)}
          onClick={() => save.mutate({ enabled, template_id: templateId, parameters })}
        >
          {save.isPending ? 'Guardando…' : 'Guardar aviso'}
        </Button>
      </div>
    </div>
  )
}
