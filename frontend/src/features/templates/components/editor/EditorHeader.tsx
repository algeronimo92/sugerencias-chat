import { AlertCircle, ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import { Button } from '../../../../shared/ui/Button'
import { cn } from '../../../../shared/utils/cn'
import { Notice } from './parts'

export type EditorTab = 'edit' | 'preview'

const TABS: { value: EditorTab; label: string }[] = [
  { value: 'edit', label: 'Editar' },
  { value: 'preview', label: 'Vista previa' },
]

interface Props {
  listPath: string
  formId: string
  title: string
  /** Tipo de plantilla y en qué está: «Interna · Cambios sin guardar». */
  subtitle: string
  submitLabel: string
  saving: boolean
  /** Cuántos puntos faltan corregir tras intentar guardar. */
  pendingCount: number
  serverError: string | null
  /** El error vino de un guardado que no llegó a hacerse. */
  saveFailed: boolean
  tab: EditorTab
  onTab: (tab: EditorTab) => void
  onLeave: () => void
  onShowPending: () => void
}

/**
 * La cabecera fija del editor: dónde se está, qué falta corregir y las
 * acciones. Guardar vive acá en escritorio y en el pie en el celular, donde
 * la cabecera lleva las pestañas «Editar / Vista previa».
 */
export function EditorHeader({ listPath, formId, title, subtitle, submitLabel, saving, pendingCount, serverError, saveFailed, tab, onTab, onLeave, onShowPending }: Props) {
  return (
    <header className="shrink-0 border-b border-line bg-surface">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 lg:px-8">
        <Link to={listPath} className="-ml-2 inline-flex h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-medium text-fg-muted outline-none hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />Plantillas
        </Link>
        <div className="min-w-0 flex-[1_1_12rem]">
          <h1 className="truncate text-xl font-semibold text-fg">{title}</h1>
          <p className="text-sm text-fg-muted">{subtitle}</p>
        </div>
        {pendingCount > 0 && (
          <button type="button" onClick={onShowPending} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-danger-fg outline-none hover:bg-danger-soft focus-visible:ring-2 focus-visible:ring-ring">
            <AlertCircle className="h-4 w-4" aria-hidden="true" />
            {pendingCount === 1 ? 'Falta corregir 1 punto' : `Falta corregir ${pendingCount} puntos`}
          </button>
        )}
        <div className="hidden gap-2 lg:flex">
          <Button variant="secondary" onClick={onLeave} disabled={saving}>Cancelar</Button>
          <Button type="submit" form={formId} loading={saving}>{submitLabel}</Button>
        </div>
      </div>
      {serverError && (
        <div className="px-4 pb-3 lg:px-8">
          <Notice tone="danger">
            <p className="whitespace-pre-line font-medium">{serverError}</p>
            {/* Sin esto el borrador que queda en el navegador se confundía
                con un cambio guardado. */}
            {saveFailed && <p className="mt-1">No se guardó ni se envió a Meta. Lo que escribiste sigue solo en este dispositivo.</p>}
          </Notice>
        </div>
      )}
      <div role="tablist" aria-label="Editar o ver la vista previa" className="grid grid-cols-2 px-4 lg:hidden">
        {TABS.map(option => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={tab === option.value}
            onClick={() => onTab(option.value)}
            className={cn('h-11 border-b-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring', tab === option.value ? 'border-accent-strong font-semibold text-accent-strong' : 'border-transparent font-medium text-fg-muted')}
          >
            {option.label}
          </button>
        ))}
      </div>
    </header>
  )
}
