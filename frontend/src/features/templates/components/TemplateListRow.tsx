import { AlertCircle, Check, Clock3, Copy, Eye, MoreVertical, Paperclip, RefreshCw, Trash2, TriangleAlert, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Badge } from '../../../shared/ui/Badge'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../../../shared/ui/DropdownMenu'
import { cn } from '../../../shared/utils/cn'
import { metaEditRules } from '../domain/metaEditRules'
import { whenLabel } from '../domain/whenLabel'
import { officialCategoryLabel, officialStatus, rejectedReason, snippet, type StatusTone } from '../domain/templateList'
import type { MessageTemplate } from '../types'
import { TemplatePreviewDialog } from './TemplatePreviewDialog'

/** Columnas de la lista en escritorio; la cabecera usa la misma grilla. */
export const LIST_GRID = 'md:grid md:grid-cols-[minmax(0,1fr)_11rem_9rem_5rem_13rem] md:items-center md:gap-4'

const STATUS_ICON: Record<StatusTone, typeof Check> = { success: Check, warning: Clock3, danger: AlertCircle, neutral: TriangleAlert }

const INTERACTIVE_LABEL: Record<string, string> = { button: 'Con botones', list: 'Con lista' }

function deleteDescription(template: MessageTemplate): string {
  const guard = 'Si una automatización todavía la usa, el sistema impedirá el borrado.'
  if (template.imported_from_meta) return `Desaparecerá de la app, pero seguirá existiendo en Meta: puedes volver a importarla cuando quieras. ${guard}`
  if (template.template_type === 'official' && template.meta_template_id != null) return `Desaparecerá para todo el equipo y también se borrará de Meta. ${guard}`
  return `Desaparecerá para todo el equipo. Sus archivos quedan en la biblioteca. ${guard}`
}

/** Lo que acompaña al nombre: atajo, origen, quién la ve y su formato. */
function detailsOf(template: MessageTemplate): string[] {
  return [
    template.shortcut ? `/${template.shortcut}` : null,
    template.imported_from_meta ? 'Importada de Meta' : null,
    template.visibility === 'personal' ? 'Solo tú la ves' : null,
    INTERACTIVE_LABEL[template.interactive_type] ?? null,
  ].filter((detail): detail is string => detail !== null)
}

/** El motivo por el que Meta la rechazó, si lo hizo. */
function rejectionOf(template: MessageTemplate): string | null {
  if (template.template_type !== 'official') return null
  return officialStatus(template.official_status).kind === 'rejected' ? rejectedReason(template.official_rejected_reason) : null
}

function RowSummary({ template, editPath, unsent }: { template: MessageTemplate; editPath: string; unsent: boolean }) {
  const details = detailsOf(template)
  const rejection = rejectionOf(template)
  const files = template.attachments.length
  return (
    <div className="min-w-0">
      <p className="flex min-w-0 items-baseline gap-2">
        <Link to={editPath} className="truncate text-sm font-semibold text-fg outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring" title={template.name}>
          {template.name.replace(/\s+/g, ' ').trim()}
        </Link>
        {details.length > 0 && <span className="shrink-0 text-xs text-fg-muted">{details.join(' · ')}</span>}
        {/* Hay cambios escritos en este dispositivo que no llegaron a
            guardarse: sin la marca, la lista los daba por inexistentes. */}
        {unsent && <Link to={editPath} className="shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"><Badge variant="warning" size="md">Cambios sin enviar</Badge></Link>}
      </p>
      {rejection ? (
        <p className="mt-0.5 text-sm text-danger-fg">
          Meta: {rejection.charAt(0).toLowerCase() + rejection.slice(1)}. <Link to={editPath} className="font-semibold underline">Corregir y reenviar</Link>
        </p>
      ) : (
        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-fg-muted">
          <span className="truncate">{snippet(template.content)}</span>
          {files > 0 && (
            <span className="inline-flex shrink-0 items-center gap-1 text-xs"><Paperclip className="h-3.5 w-3.5" aria-hidden="true" />{files}<span className="sr-only"> archivo{files === 1 ? '' : 's'}</span></span>
          )}
        </p>
      )}
    </div>
  )
}

/** Estado, categoría y usos. En el celular comparten una línea; en
 *  escritorio cada uno ocupa su columna (`md:contents`). */
function RowFacts({ template }: { template: MessageTemplate }) {
  const status = template.template_type === 'official' ? officialStatus(template.official_status) : null
  const StatusIcon = status ? STATUS_ICON[status.tone] : null
  const uses = template.use_count
  const editableFrom = metaEditRules(template).editableFrom
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 md:contents">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 md:block">
        {status && StatusIcon ? (
          <>
            <Badge variant={status.tone} size="md"><StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />{status.label}</Badge>
            <p className="text-xs text-fg-muted md:mt-1">Oficial · {officialCategoryLabel(template.official_category)}</p>
          </>
        ) : (
          <p className="text-sm text-fg-muted">Interna · lista para usar</p>
        )}
        {editableFrom !== null && <p className="text-xs text-fg-muted md:mt-1">Editable desde {whenLabel(editableFrom)}</p>}
        {!template.is_active && <p className="text-xs font-medium text-fg-muted md:mt-1">Desactivada</p>}
      </div>
      <p className="text-sm text-fg"><span className="text-fg-muted md:hidden">Categoría: </span>{template.category}</p>
      <p className="text-sm tabular-nums text-fg">
        {uses > 0
          ? <>{uses}<span className="text-fg-muted md:hidden"> uso{uses === 1 ? '' : 's'}</span></>
          : <span className="text-fg-muted">Sin usar</span>}
      </p>
    </div>
  )
}

interface ActionsProps {
  template: MessageTemplate
  editPath: string
  busy: boolean
  onToggleActive: (active: boolean) => void
  onSync: () => void
  onDuplicate: () => void
  onPreview: () => void
  onAskDelete: () => void
  /** Solo si hay cambios sin enviar en este dispositivo. */
  onDiscardUnsent?: () => void
}

function RowActions({ template, editPath, busy, onToggleActive, onSync, onDuplicate, onPreview, onAskDelete, onDiscardUnsent }: ActionsProps) {
  const active = template.is_active
  const syncable = template.template_type === 'official' && template.meta_template_id != null
  return (
    <div className="flex items-center gap-2 md:justify-end">
      <button
        type="button"
        aria-label={`Vista previa de ${template.name}`}
        title="Vista previa: cómo queda en el chat del lead"
        onClick={onPreview}
        className="flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted outline-none hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Eye className="h-4 w-4" aria-hidden="true" />
      </button>
      <Link to={editPath} className="inline-flex h-10 items-center rounded-lg px-2 text-sm font-semibold text-accent-strong outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring">Editar</Link>
      <button
        type="button"
        role="switch"
        aria-checked={active}
        aria-label={`${template.name}: plantilla activa`}
        title={active ? 'Activa: el equipo la ve en el chat' : 'Desactivada: no aparece en el chat'}
        disabled={busy}
        onClick={() => onToggleActive(!active)}
        className={cn(
          'flex h-6 w-10 shrink-0 items-center rounded-full p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-50',
          active ? 'justify-end bg-accent-fill' : 'justify-start bg-line-control',
        )}
      >
        <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
      </button>
      <DropdownMenu
        align="end"
        trigger={
          <button type="button" aria-label={`Más acciones de ${template.name}`} className="flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted outline-none hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring">
            <MoreVertical className="h-4 w-4" aria-hidden="true" />
          </button>
        }
      >
        <DropdownMenuItem icon={Copy} onSelect={onDuplicate}>Duplicar</DropdownMenuItem>
        {syncable && <DropdownMenuItem icon={RefreshCw} onSelect={onSync}>Consultar el estado en Meta</DropdownMenuItem>}
        {onDiscardUnsent && <DropdownMenuItem icon={Undo2} onSelect={onDiscardUnsent}>Descartar los cambios sin enviar</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={Trash2} danger onSelect={onAskDelete}>Eliminar</DropdownMenuItem>
      </DropdownMenu>
    </div>
  )
}

interface Props {
  template: MessageTemplate
  /** Recién guardada: se resalta y se trae a la vista. */
  highlighted: boolean
  busy: boolean
  onToggleActive: (active: boolean) => void
  onSync: () => void
  onDuplicate: () => void
  onDelete: () => void
  /** Tiene cambios escritos en este dispositivo que no se guardaron. */
  unsent: boolean
  onDiscardUnsent: () => void
}

/**
 * Una plantilla en la lista: fila en escritorio, tarjeta en el celular
 * (2026-11-23). El estado de Meta va en español y con color e icono; antes
 * era «APPROVED» en azul, igual para una aprobada que para una rechazada.
 */
export function TemplateListRow({ template, highlighted, busy, onToggleActive, onSync, onDuplicate, onDelete, unsent, onDiscardUnsent }: Props) {
  const row = useRef<HTMLLIElement>(null)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const editPath = `/templates/${template.id}`

  useEffect(() => {
    if (highlighted) row.current?.scrollIntoView({ block: 'center' })
  }, [highlighted])

  return (
    <li
      ref={row}
      aria-busy={busy || undefined}
      className={cn(
        'flex flex-col gap-3 border-t border-line px-4 py-3.5 first:border-t-0 md:px-5',
        LIST_GRID,
        highlighted && 'bg-accent-soft',
        !template.is_active && 'bg-subtle',
      )}
    >
      <RowSummary template={template} editPath={editPath} unsent={unsent} />
      <RowFacts template={template} />
      <RowActions
        template={template}
        editPath={editPath}
        busy={busy}
        onToggleActive={onToggleActive}
        onSync={onSync}
        onDuplicate={onDuplicate}
        onPreview={() => setPreviewing(true)}
        onAskDelete={() => setConfirmingDelete(true)}
        onDiscardUnsent={unsent ? onDiscardUnsent : undefined}
      />
      {previewing && <TemplatePreviewDialog template={template} onClose={() => setPreviewing(false)} />}
      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={`Eliminar «${template.name}»`}
        description={deleteDescription(template)}
        confirmLabel="Eliminar plantilla"
        onConfirm={onDelete}
      />
    </li>
  )
}
