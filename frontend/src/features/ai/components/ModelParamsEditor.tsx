import { ChevronDown, RotateCcw, SlidersHorizontal } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input, Select, labelClass } from '../../../shared/ui/Input'
import type { AiModelParam, AiModelParams } from '../types'

export type ParamOverrides = Record<string, string | number | string[]>
type Draft = Record<string, string>

/** Lo guardado → texto editable ('' = usar el default del modelo). */
function toDraft(overrides: ParamOverrides): Draft {
  return Object.fromEntries(Object.entries(overrides).map(([name, value]) => [name, Array.isArray(value) ? value.join(', ') : String(value)]))
}

/** Texto editable → lo que se guarda; lo vacío no se manda (vuelve al default). */
function fromDraft(draft: Draft, params: AiModelParam[]): ParamOverrides {
  const result: ParamOverrides = {}
  for (const param of params) {
    const raw = (draft[param.name] ?? '').trim()
    if (!raw) continue
    if (param.kind === 'choice') result[param.name] = raw
    else if (param.kind === 'text_list') result[param.name] = raw.split(',').map(item => item.trim()).filter(Boolean)
    else result[param.name] = Number(raw)
  }
  return result
}

function defaultLabel(param: AiModelParam): string {
  return param.default == null ? 'el del proveedor' : String(param.default)
}

/** Un parámetro que depende de otro (temperature solo con razonamiento 'none'). */
function unmetRequirement(param: AiModelParam, draft: Draft, byName: Map<string, AiModelParam>): string | null {
  for (const [other, allowed] of Object.entries(param.requires ?? {})) {
    const otherParam = byName.get(other)
    const current = draft[other] || (otherParam?.default != null ? String(otherParam.default) : '')
    if (!allowed.includes(current)) return `Solo con ${(otherParam?.label ?? other).toLowerCase()} '${allowed.join(' / ')}'.`
  }
  return null
}

function fieldHint(param: AiModelParam, disabledReason: string | null): string {
  if (disabledReason) return disabledReason
  const numeric = param.kind === 'float' || param.kind === 'int'
  const range = numeric && param.min != null ? `Entre ${param.min} y ${param.max}.` : ''
  return [range, param.help].filter(Boolean).join(' ')
}

function textPlaceholder(param: AiModelParam): string {
  if (param.kind === 'text_list') return `Separadas por coma (máx. ${param.max ?? '—'})`
  return param.default == null ? 'Vacío = el del proveedor' : `Por defecto: ${param.default}`
}

interface FieldProps {
  id: string
  param: AiModelParam
  value: string
  disabled: boolean
  onChange: (value: string) => void
}

function ChoiceInput({ id, param, value, disabled, onChange }: FieldProps) {
  return (
    <Select id={id} aria-label={param.label} value={value} disabled={disabled} onValueChange={onChange}>
      <option value="">Por defecto ({defaultLabel(param)})</option>
      {(param.choices ?? []).map(choice => <option key={choice} value={choice}>{choice}</option>)}
    </Select>
  )
}

function TextInput({ id, param, value, disabled, onChange }: FieldProps) {
  return (
    <Input
      id={id}
      inputMode={param.kind === 'text_list' ? 'text' : 'decimal'}
      value={value}
      disabled={disabled}
      onChange={event => onChange(event.target.value)}
      placeholder={textPlaceholder(param)}
    />
  )
}

function ParamField({ param, value, disabledReason, disabled, onChange }: {
  param: AiModelParam
  value: string
  disabledReason: string | null
  disabled: boolean
  onChange: (value: string) => void
}) {
  const id = `param-${param.name}`
  const hint = fieldHint(param, disabledReason)
  const Field = param.kind === 'choice' ? ChoiceInput : TextInput
  return (
    <div>
      <label htmlFor={id} className={labelClass}>{param.label}</label>
      <Field id={id} param={param} value={value} disabled={disabled || Boolean(disabledReason)} onChange={onChange} />
      {hint && <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">{hint}</p>}
    </div>
  )
}

/**
 * Parámetros del modelo de una posición (principal o secundario). Lo que el
 * negocio deja vacío toma el default del registro del backend; el backend
 * valida lo que se guarda contra lo que ese modelo acepta. El formulario sale
 * del esquema que manda el backend: un modelo nuevo no necesita cambios acá.
 * Se monta con `key` del modelo y lo guardado: al cambiar cualquiera de los
 * dos, el borrador se rehace desde cero.
 */
export function ModelParamsEditor({ title, schema, overrides, disabled, onSave }: {
  title: string
  schema: AiModelParams | undefined
  overrides: ParamOverrides
  disabled: boolean
  onSave: (overrides: ParamOverrides) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(overrides))
  if (!schema) return null
  const customized = Object.keys(overrides).length
  const byName = new Map(schema.params.map(param => [param.name, param]))

  return (
    <section aria-label={title} className="space-y-3 rounded-lg border border-wa-border/70 p-3 dark:border-wa-border-dark/70">
      <div>
        <h4 className="text-xs font-semibold text-wa-text dark:text-wa-text-dark">{title} · {schema.label}</h4>
        <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
          {customized ? `${customized} ajuste${customized === 1 ? '' : 's'} personalizado${customized === 1 ? '' : 's'}` : 'Valores por defecto'}
          {schema.note ? ` · ${schema.note}` : ''}
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {schema.params.map(param => (
          <ParamField
            key={param.name}
            param={param}
            value={draft[param.name] ?? ''}
            disabledReason={unmetRequirement(param, draft, byName)}
            disabled={disabled}
            onChange={value => setDraft(current => ({ ...current, [param.name]: value }))}
          />
        ))}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={disabled || !customized} onClick={() => onSave({})}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Volver a los valores por defecto
        </Button>
        <Button size="sm" disabled={disabled} onClick={() => onSave(fromDraft(draft, schema.params))}>Guardar ajustes</Button>
      </div>
    </section>
  )
}

/**
 * Los parámetros de los modelos son para quien sabe qué está tocando: quedan
 * plegados bajo "Configuración avanzada" y la tarjeta muestra a simple vista
 * solo claves y modelos.
 */
export function AdvancedModelSettings({ customized, children }: { customized: number; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-wa-border/70 dark:border-wa-border-dark/70">
      <button type="button" onClick={() => setOpen(current => !current)} aria-expanded={open} aria-controls="ia-config-avanzada"
        className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left text-sm font-medium text-wa-text dark:text-wa-text-dark">
        <span className="flex items-center gap-2">
          <SlidersHorizontal className="h-4 w-4 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
          Configuración avanzada
          <span className="text-xs font-normal text-wa-muted dark:text-wa-muted-dark">
            {customized ? `· ${customized} ajuste${customized === 1 ? '' : 's'} personalizado${customized === 1 ? '' : 's'}` : '· valores por defecto'}
          </span>
        </span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div id="ia-config-avanzada" className="space-y-3 border-t border-wa-border/70 p-3 dark:border-wa-border-dark/70">
          <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
            Parámetros con los que cada modelo genera las sugerencias. Cada modelo acepta los suyos; lo que dejes vacío usa el valor recomendado.
          </p>
          <div className="grid gap-3 lg:grid-cols-2">{children}</div>
        </div>
      )}
    </div>
  )
}
