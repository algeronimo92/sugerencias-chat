import { useMemo, useState } from 'react'
import {
  Activity, AlertTriangle, Ban, Bot, CheckCircle2, ChevronDown, Clock3, Copy,
  GitBranch, History, Loader2, Pencil, Plus, Power, RotateCcw, Save, Trash2, XCircle,
} from 'lucide-react'
import type {
  AutomationAction, AutomationActionType, AutomationConditions, AutomationRule,
  AutomationTrigger,
} from '../types'
import { isLeadStage, LEAD_STAGES } from '../types'
import {
  useAutomationExecutions, useAutomationRules, useCancelExecution, useCreateAutomation,
  useDuplicateAutomation, useRetryExecution, useUpdateAutomation,
} from '../hooks/useAutomations'
import { useUsers } from '../hooks/useUsers'
import { useTags } from '../hooks/useLeadMeta'
import { useTemplates } from '../hooks/useTemplates'
import { extractErrorMessage } from '../utils/errors'
import { VisualFlowBuilder } from './VisualFlowBuilder'
import {
  AUTOMATION_ACTION_LABELS as ACTION_LABELS,
  AUTOMATION_TRIGGERS as TRIGGERS,
  AutomationExecutionStatus,
  AutomationActionType as ActionType,
  AutomationBuilderMode,
  AutomationRecipient,
  AutomationTrigger as TriggerType,
  RESPONSE_OVERDUE_TRIGGERS,
  TASK_TYPE_OPTIONS as TASK_TYPES,
  TaskPriorityValue,
  TaskTypeValue,
  assertNever,
  isAutomationActionType,
  isAutomationTrigger,
  isTaskPriority,
  isTaskType,
} from '../domain/automationCatalog'

function defaultAction(type: AutomationActionType): AutomationAction {
  switch (type) {
    case ActionType.CreateTask:
      return { type, title: 'Dar seguimiento a {{nombre}}', description: '', task_type: TaskTypeValue.FollowUp, priority: TaskPriorityValue.Normal, due_minutes: 60, remind_minutes_before: 15, assigned_user_id: null }
    case ActionType.AssignSeller:
      return { type, user_id: null }
    case ActionType.AddTag:
    case ActionType.RemoveTag:
      return { type, tag_id: null }
    case ActionType.ChangeStage:
      return { type, stage: 'en_diagnostico' }
    case ActionType.Notify:
      return { type, recipient: AutomationRecipient.Seller, user_id: null, title: 'Seguimiento pendiente', body: 'Revisa el lead {{nombre}}.' }
    case ActionType.SendTemplate:
      return { type, template_id: null }
    default:
      return assertNever(type)
  }
}

interface RuleForm {
  name: string
  triggerType: AutomationTrigger
  triggerMinutes: number
  delayMinutes: number
  maxExecutionsPerHour: number | null
  conditions: AutomationConditions
  actions: AutomationAction[]
  isActive: boolean
}

const EMPTY_FORM: RuleForm = {
  name: '', triggerType: TriggerType.LeadCreated, triggerMinutes: 30, delayMinutes: 0, maxExecutionsPerHour: null,
  conditions: { stage: null, origin_contains: '', service_contains: '', seller_id: null, tag_id: null, require_open_window: false, business_hours_only: false, cooldown_minutes: null },
  actions: [defaultAction(ActionType.CreateTask)], isActive: true,
}

function triggerLabel(value: AutomationTrigger) {
  return TRIGGERS.find(item => item.value === value)?.label ?? value
}

function actionLabel(value: unknown) {
  const type = String(value)
  return isAutomationActionType(type) ? ACTION_LABELS[type] : type
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' }) : 'Nunca'
}

function executionTone(status: string) {
  if (status === AutomationExecutionStatus.Completed) return 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300'
  if (status === AutomationExecutionStatus.Failed) return 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
  if (status === AutomationExecutionStatus.Skipped) return 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
  return 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
}

function validateForm(form: RuleForm) {
  const errors: string[] = []
  if (!form.name.trim()) errors.push('Escribe un nombre para la regla.')
  if (RESPONSE_OVERDUE_TRIGGERS.has(form.triggerType) && (!form.triggerMinutes || form.triggerMinutes < 1 || form.triggerMinutes > 43200)) errors.push('La demora debe estar entre 1 minuto y 30 días.')
  if (!form.actions.length || form.actions.length > 10) errors.push('Configura entre 1 y 10 acciones.')
  form.actions.forEach((action, index) => {
    const prefix = `Acción ${index + 1}`
    if (action.type === ActionType.CreateTask && (!action.title.trim() || !action.due_minutes || action.due_minutes < 1)) errors.push(`${prefix}: completa el título y vencimiento de la tarea.`)
    if (action.type === ActionType.CreateTask && action.remind_minutes_before >= action.due_minutes) errors.push(`${prefix}: el recordatorio debe ser anterior al vencimiento.`)
    if (action.type === ActionType.AssignSeller && !action.user_id) errors.push(`${prefix}: selecciona un vendedor.`)
    if ((action.type === ActionType.AddTag || action.type === ActionType.RemoveTag) && !action.tag_id) errors.push(`${prefix}: selecciona una etiqueta.`)
    if (action.type === ActionType.Notify && (!action.title.trim() || !action.body.trim() || (action.recipient === AutomationRecipient.Specific && !action.user_id))) errors.push(`${prefix}: completa destinatario, título y contenido.`)
    if (action.type === ActionType.SendTemplate && !action.template_id) errors.push(`${prefix}: selecciona una plantilla.`)
  })
  return errors
}

export function AutomationsPage() {
  const { data: rules = [], isLoading } = useAutomationRules()
  const { data: executions = [] } = useAutomationExecutions()
  const { data: users = [] } = useUsers(true)
  const { data: tags = [] } = useTags()
  const { data: templates = [] } = useTemplates(true)
  const create = useCreateAutomation()
  const update = useUpdateAutomation()
  const duplicate = useDuplicateAutomation()
  const retryExecution = useRetryExecution()
  const cancelExecution = useCancelExecution()
  const [tab, setTab] = useState<'rules' | 'flows' | 'history'>('rules')
  const [form, setForm] = useState<RuleForm>(EMPTY_FORM)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [formOpen, setFormOpen] = useState(false)
  const [flowBuilder, setFlowBuilder] = useState<{ rule?: AutomationRule } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const activeUsers = users.filter(user => user.is_active)
  const automaticTemplates = useMemo(() => templates.filter(template => template.is_active && template.template_type === 'internal' && template.interactive_type === 'none'), [templates])
  const isSaving = create.isPending || update.isPending
  const simpleRules = rules.filter(rule => rule.builder_mode !== AutomationBuilderMode.Visual)
  const visualRules = rules.filter(rule => rule.builder_mode === AutomationBuilderMode.Visual)

  function openCreate() {
    setEditingId(null); setForm(EMPTY_FORM); setError(null); setFormOpen(true)
  }

  function openEdit(rule: AutomationRule) {
    setEditingId(rule.id)
    setForm({
      name: rule.name,
      triggerType: rule.trigger_type,
      triggerMinutes: rule.trigger_config.minutes ?? 30,
      delayMinutes: rule.delay_minutes,
      maxExecutionsPerHour: rule.max_executions_per_hour,
      conditions: { ...EMPTY_FORM.conditions, ...rule.conditions },
      actions: rule.actions,
      isActive: rule.is_active,
    })
    setError(null); setFormOpen(true)
  }

  function closeForm() {
    if (isSaving) return
    setFormOpen(false); setEditingId(null); setError(null)
  }

  function setAction(index: number, nextAction: AutomationAction) {
    setForm(current => ({ ...current, actions: current.actions.map((action, actionIndex) => actionIndex === index ? nextAction : action) }))
  }

  function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null)
    const errors = validateForm(form)
    if (errors.length) { setError(errors.join('\n')); return }
    const input = {
      name: form.name.trim(),
      trigger_type: form.triggerType,
      trigger_config: RESPONSE_OVERDUE_TRIGGERS.has(form.triggerType) ? { minutes: Number(form.triggerMinutes) } : {},
      conditions: {
        stage: form.conditions.stage || null,
        origin_contains: form.conditions.origin_contains?.trim() || null,
        service_contains: form.conditions.service_contains?.trim() || null,
        seller_id: form.conditions.seller_id || null,
        tag_id: form.conditions.tag_id || null,
        require_open_window: !!form.conditions.require_open_window,
        business_hours_only: !!form.conditions.business_hours_only,
        cooldown_minutes: form.conditions.cooldown_minutes || null,
      },
      actions: form.actions,
      delay_minutes: Number(form.delayMinutes) || 0,
      max_executions_per_hour: form.maxExecutionsPerHour || null,
      is_active: form.isActive,
    }
    const options = { onSuccess: closeForm, onError: (reason: unknown) => setError(extractErrorMessage(reason)) }
    if (editingId == null) create.mutate(input, options)
    else update.mutate({ id: editingId, ...input }, options)
  }

  function toggleRule(rule: AutomationRule) {
    setError(null)
    update.mutate({ id: rule.id, is_active: !rule.is_active }, { onError: reason => setError(extractErrorMessage(reason)) })
  }

  function duplicateRule(rule: AutomationRule) {
    setError(null)
    duplicate.mutate(rule.id, { onError: reason => setError(extractErrorMessage(reason)) })
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-4 dark:bg-gray-950 sm:p-6">
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div><div className="flex items-center gap-2"><Bot className="h-5 w-5 text-green-600" /><h1 className="text-xl font-semibold text-gray-900 dark:text-white">Automatizaciones</h1></div><p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Reglas simples, seguras y auditables para el trabajo comercial.</p></div>
          <button type="button" onClick={() => tab === 'flows' ? setFlowBuilder({}) : openCreate()} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-3 py-2 text-sm font-semibold text-white hover:bg-green-700"><Plus className="h-4 w-4" />{tab === 'flows' ? 'Nuevo flujo visual' : 'Nueva automatización'}</button>
        </div>

        <div className="mb-4 flex w-fit rounded-lg bg-gray-200 p-1 dark:bg-gray-800">
          <button type="button" onClick={() => setTab('rules')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${tab === 'rules' ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}><GitBranch className="h-3.5 w-3.5" />Reglas ({simpleRules.length})</button>
          <button type="button" onClick={() => setTab('flows')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${tab === 'flows' ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}><Bot className="h-3.5 w-3.5" />Flujos visuales ({visualRules.length})</button>
          <button type="button" onClick={() => setTab('history')} className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${tab === 'history' ? 'bg-white text-gray-900 shadow dark:bg-gray-700 dark:text-white' : 'text-gray-500 dark:text-gray-400'}`}><History className="h-3.5 w-3.5" />Historial ({executions.length})</button>
        </div>

        {error && !formOpen && <div className="mb-4 whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

        {tab === 'rules' ? (
          isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div> : simpleRules.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-900"><Bot className="mx-auto h-10 w-10 text-gray-300" /><p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Todavía no hay automatizaciones</p><p className="mt-1 text-xs text-gray-500">Crea la primera regla para asignar, notificar o programar seguimientos.</p></div>
          ) : <div className="grid gap-3 lg:grid-cols-2">{simpleRules.map(rule => (
            <article key={rule.id} className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-gray-900 ${rule.is_active ? 'border-green-200 dark:border-green-900' : 'border-gray-200 opacity-75 dark:border-gray-800'}`}>
              <div className="flex items-start gap-3"><span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${rule.is_active ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' : 'bg-gray-100 text-gray-500 dark:bg-gray-800'}`}><Bot className="h-4 w-4" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{rule.name}</h2><p className="mt-0.5 text-xs text-gray-500">Cuando: {triggerLabel(rule.trigger_type)}{rule.trigger_config.minutes ? ` · ${rule.trigger_config.minutes} min` : ''}</p></div><div className="flex gap-1"><button type="button" onClick={() => openEdit(rule)} title="Editar" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={duplicate.isPending} onClick={() => duplicateRule(rule)} title="Duplicar" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:hover:bg-gray-800"><Copy className="h-3.5 w-3.5" /></button><button type="button" onClick={() => toggleRule(rule)} title={rule.is_active ? 'Desactivar' : 'Activar'} className={`rounded-lg p-2 ${rule.is_active ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-950' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}><Power className="h-3.5 w-3.5" /></button></div></div>
                <div className="mt-3 flex flex-wrap gap-1.5">{rule.actions.map((action, index) => <span key={index} className="rounded-full bg-violet-50 px-2 py-1 text-[10px] font-medium text-violet-700 dark:bg-violet-950/40 dark:text-violet-300">{index + 1}. {ACTION_LABELS[action.type]}</span>)}{rule.delay_minutes > 0 && <span className="rounded-full bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">Espera {rule.delay_minutes} min</span>}{rule.max_executions_per_hour && <span className="rounded-full bg-sky-50 px-2 py-1 text-[10px] font-medium text-sky-700 dark:bg-sky-950/40 dark:text-sky-300">Máx. {rule.max_executions_per_hour}/h</span>}</div>
                <div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-[10px] text-gray-400 dark:border-gray-800"><span>{rule.execution_count} ejecuciones · última {formatDate(rule.last_execution_at)}</span>{rule.last_execution_status && <span className={`rounded-full px-2 py-0.5 ${executionTone(rule.last_execution_status)}`}>{rule.last_execution_status}</span>}</div>
              </div></div>
            </article>
          ))}</div>
        ) : tab === 'flows' ? (
          isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-gray-400" /></div> : visualRules.length === 0 ? <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-gray-700 dark:bg-gray-900"><Bot className="mx-auto h-10 w-10 text-gray-300" /><p className="mt-3 text-sm font-semibold text-gray-700 dark:text-gray-200">Todavía no hay flujos visuales</p><p className="mt-1 text-xs text-gray-500">Conecta disparadores, condiciones, acciones y esperas en un lienzo.</p><button type="button" onClick={() => setFlowBuilder({})} className="mt-4 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white"><Plus className="mr-1 inline h-3.5 w-3.5" />Crear primer flujo</button></div> : <div className="grid gap-3 lg:grid-cols-2">{visualRules.map(rule => {
            const nodes = 'nodes' in rule.flow_definition ? rule.flow_definition.nodes.length : 0
            const hasPublished = !!rule.published_flow_definition
            const hasDraftChanges = hasPublished && JSON.stringify(rule.flow_definition) !== JSON.stringify(rule.published_flow_definition)
            return <article key={rule.id} className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-gray-900 ${rule.is_active ? 'border-green-200 dark:border-green-900' : 'border-gray-200 dark:border-gray-800'}`}><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><GitBranch className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h2 className="truncate text-sm font-semibold text-gray-900 dark:text-white">{rule.name}</h2><p className="mt-0.5 text-[11px] text-gray-500">{nodes} bloques · {triggerLabel(rule.trigger_type)}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => setFlowBuilder({ rule })} title="Abrir constructor" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-800"><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={duplicate.isPending} onClick={() => duplicateRule(rule)} title="Duplicar" className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700 disabled:opacity-40 dark:hover:bg-gray-800"><Copy className="h-3.5 w-3.5" /></button>{hasPublished && <button type="button" onClick={() => toggleRule(rule)} title={rule.is_active ? 'Pausar' : 'Reanudar'} className={`rounded-lg p-2 ${rule.is_active ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-950' : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'}`}><Power className="h-3.5 w-3.5" /></button>}</div></div><div className="mt-3 flex flex-wrap gap-1.5"><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${rule.is_active ? 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300' : hasPublished ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300'}`}>{rule.is_active ? `Publicado · v${rule.flow_version}` : hasPublished ? 'Pausado' : 'Borrador'}</span>{hasDraftChanges && <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">Cambios sin publicar</span>}</div><div className="mt-3 flex items-center justify-between border-t border-gray-100 pt-3 text-[10px] text-gray-400 dark:border-gray-800"><span>{rule.execution_count} ejecuciones · última {formatDate(rule.last_execution_at)}</span><button type="button" onClick={() => setFlowBuilder({ rule })} className="font-semibold text-green-600">Editar flujo →</button></div></div></div></article>
          })}</div>
        ) : (
          <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
            {executions.length === 0 ? <p className="px-4 py-16 text-center text-sm text-gray-500">Aún no hay ejecuciones.</p> : executions.map(execution => (
              <details key={execution.id} className="group border-b border-gray-100 last:border-0 dark:border-gray-800">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800/60"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${executionTone(execution.status)}`}>{execution.status === AutomationExecutionStatus.Completed ? <CheckCircle2 className="h-4 w-4" /> : execution.status === AutomationExecutionStatus.Failed ? <XCircle className="h-4 w-4" /> : execution.status === AutomationExecutionStatus.Skipped ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-gray-800 dark:text-gray-100">{execution.rule_name}</span><span className="block truncate text-[10px] text-gray-500">{execution.lead_name || execution.lead_id || 'Lead eliminado'} · {triggerLabel(execution.trigger_type)} · {formatDate(execution.created_at)}</span></span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${executionTone(execution.status)}`}>{execution.status}</span><ChevronDown className="h-4 w-4 text-gray-400 transition-transform group-open:rotate-180" /></summary>
                <div className="bg-gray-50 px-4 py-3 text-xs dark:bg-gray-950/60"><p className="text-gray-500">Programada: {formatDate(execution.scheduled_for)} · Finalizada: {formatDate(execution.finished_at)}</p>{execution.error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">{execution.error}</p>}<div className="mt-2 space-y-1">{execution.action_results.map((result, index) => <div key={index} className="rounded-lg border border-gray-200 bg-white px-3 py-2 dark:border-gray-800 dark:bg-gray-900"><span className="font-semibold">{String(result.position ?? index + 1)}. {actionLabel(result.type)}</span><span className="ml-2 text-gray-500">{String(result.status ?? '')}{result.error ? ` · ${String(result.error)}` : ''}</span></div>)}</div><div className="mt-3 flex gap-2">{(execution.status === AutomationExecutionStatus.Failed || execution.status === AutomationExecutionStatus.Skipped) && <button type="button" disabled={retryExecution.isPending} onClick={() => { setError(null); retryExecution.mutate(execution.id, { onError: reason => setError(extractErrorMessage(reason)) }) }} className="flex items-center gap-1.5 rounded-lg border border-green-600 px-3 py-1.5 text-[11px] font-semibold text-green-700 disabled:opacity-40 dark:text-green-400"><RotateCcw className="h-3.5 w-3.5" />Reintentar</button>}{(execution.status === AutomationExecutionStatus.Scheduled || execution.status === AutomationExecutionStatus.Running) && <button type="button" disabled={cancelExecution.isPending} onClick={() => { setError(null); cancelExecution.mutate(execution.id, { onError: reason => setError(extractErrorMessage(reason)) }) }} className="flex items-center gap-1.5 rounded-lg border border-red-500 px-3 py-1.5 text-[11px] font-semibold text-red-600 disabled:opacity-40 dark:text-red-400"><Ban className="h-3.5 w-3.5" />Cancelar</button>}</div></div>
              </details>
            ))}
          </div>
        )}
      </div>

      {formOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3" onMouseDown={event => { if (event.target === event.currentTarget) closeForm() }}><form onSubmit={submit} className="automation-form flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
        <header className="flex items-center justify-between border-b border-gray-200 px-5 py-4 dark:border-gray-800"><div><h2 className="font-semibold text-gray-900 dark:text-white">{editingId == null ? 'Nueva automatización' : 'Editar automatización'}</h2><p className="text-xs text-gray-500">Todas las condiciones configuradas deben cumplirse.</p></div><button type="button" onClick={closeForm} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><XCircle className="h-5 w-5" /></button></header>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <section className="grid gap-3 md:grid-cols-2"><label className="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">Nombre<input required maxLength={120} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Ej. Seguimiento de leads nuevos" className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /></label><label className="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">Disparador<select value={form.triggerType} onChange={event => { const value = event.target.value; if (isAutomationTrigger(value)) setForm(current => ({ ...current, triggerType: value })) }} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800">{TRIGGERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><p className="text-[11px] text-gray-500 md:col-span-2">{TRIGGERS.find(item => item.value === form.triggerType)?.description}</p>{RESPONSE_OVERDUE_TRIGGERS.has(form.triggerType) && <label className="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">Minutos de espera<input required type="number" min={1} max={43200} value={form.triggerMinutes} onChange={event => setForm(current => ({ ...current, triggerMinutes: Number(event.target.value) }))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /></label>}<label className="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">Retrasar toda la regla (minutos)<input type="number" min={0} max={10080} value={form.delayMinutes} onChange={event => setForm(current => ({ ...current, delayMinutes: Number(event.target.value) }))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /></label><label className="grid gap-1 text-xs font-semibold text-gray-600 dark:text-gray-300">Máximo de ejecuciones por hora<input type="number" min={1} max={1000} placeholder="Sin límite" value={form.maxExecutionsPerHour ?? ''} onChange={event => setForm(current => ({ ...current, maxExecutionsPerHour: event.target.value ? Number(event.target.value) : null }))} className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800" /><span className="text-[10px] font-normal text-gray-400">Freno de seguridad: pasado el tope, el resto se reintenta más tarde en vez de perderse.</span></label></section>

          <section><h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200"><GitBranch className="h-3.5 w-3.5" />Condiciones opcionales</h3><div className="grid gap-3 rounded-xl border border-gray-200 p-3 dark:border-gray-700 md:grid-cols-3"><label className="grid gap-1 text-[11px] text-gray-500">Etapa<select value={form.conditions.stage ?? ''} onChange={event => { const value = event.target.value; const stage = isLeadStage(value) ? value : null; setForm(current => ({ ...current, conditions: { ...current.conditions, stage } })) }} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="">Cualquiera</option>{LEAD_STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select></label><label className="grid gap-1 text-[11px] text-gray-500">Origen contiene<input maxLength={120} value={form.conditions.origin_contains ?? ''} onChange={event => setForm(current => ({ ...current, conditions: { ...current.conditions, origin_contains: event.target.value } }))} placeholder="Facebook" className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800" /></label><label className="grid gap-1 text-[11px] text-gray-500">Servicio contiene<input maxLength={120} value={form.conditions.service_contains ?? ''} onChange={event => setForm(current => ({ ...current, conditions: { ...current.conditions, service_contains: event.target.value } }))} placeholder="Limpieza" className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800" /></label><label className="grid gap-1 text-[11px] text-gray-500">Vendedor<select value={form.conditions.seller_id ?? ''} onChange={event => setForm(current => ({ ...current, conditions: { ...current.conditions, seller_id: event.target.value ? Number(event.target.value) : null } }))} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="">Cualquiera</option>{activeUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label className="grid gap-1 text-[11px] text-gray-500">Etiqueta<select value={form.conditions.tag_id ?? ''} onChange={event => setForm(current => ({ ...current, conditions: { ...current.conditions, tag_id: event.target.value ? Number(event.target.value) : null } }))} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="">Cualquiera</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select></label><div className="flex flex-col justify-end gap-2 pb-1"><label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300"><input type="checkbox" checked={!!form.conditions.require_open_window} onChange={event => setForm(current => ({ ...current, conditions: { ...current.conditions, require_open_window: event.target.checked } }))} />Ventana de WhatsApp abierta</label><label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300"><input type="checkbox" checked={!!form.conditions.business_hours_only} onChange={event => setForm(current => ({ ...current, conditions: { ...current.conditions, business_hours_only: event.target.checked } }))} />Horario laboral 08:00–18:00</label></div><label className="grid gap-1 text-[11px] text-gray-500 md:col-span-3">No repetir para el mismo lead durante (minutos)<input type="number" min={1} max={43200} placeholder="Sin límite" value={form.conditions.cooldown_minutes ?? ''} onChange={event => setForm(current => ({ ...current, conditions: { ...current.conditions, cooldown_minutes: event.target.value ? Number(event.target.value) : null } }))} className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800" /><span className="font-normal text-[10px] text-gray-400">Evita que se le mande la misma automatización varias veces si escribe seguido. Déjalo vacío para no limitar.</span></label></div></section>

          <section><div className="mb-2 flex items-center justify-between"><h3 className="flex items-center gap-1.5 text-xs font-semibold text-gray-700 dark:text-gray-200"><Activity className="h-3.5 w-3.5" />Acciones en orden</h3><button type="button" disabled={form.actions.length >= 10} onClick={() => setForm(current => ({ ...current, actions: [...current.actions, defaultAction(ActionType.CreateTask)] }))} className="flex items-center gap-1 text-xs font-semibold text-green-700 disabled:opacity-40 dark:text-green-400"><Plus className="h-3.5 w-3.5" />Agregar</button></div><div className="space-y-3">{form.actions.map((action, index) => <div key={index} className="rounded-xl border border-violet-200 bg-violet-50/30 p-3 dark:border-violet-900 dark:bg-violet-950/10"><div className="mb-3 flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">{index + 1}</span><select value={action.type} onChange={event => { if (isAutomationActionType(event.target.value)) setAction(index, defaultAction(event.target.value)) }} className="min-w-0 flex-1 rounded-lg border border-violet-200 bg-white px-2.5 py-2 text-xs dark:border-violet-900 dark:bg-gray-800">{Object.entries(ACTION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button type="button" disabled={form.actions.length === 1} onClick={() => setForm(current => ({ ...current, actions: current.actions.filter((_, itemIndex) => itemIndex !== index) }))} className="rounded-lg p-2 text-red-500 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>
            {action.type === ActionType.CreateTask && <div className="grid gap-2 md:grid-cols-3"><label className="grid gap-1 text-[10px] text-gray-500 dark:text-gray-400 md:col-span-2">Título de la tarea<input required maxLength={160} value={action.title} onChange={event => setAction(index, { ...action, title: event.target.value })} placeholder="Ej. Dar seguimiento a {{nombre}}" className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800" /></label><label className="grid gap-1 text-[10px] text-gray-500 dark:text-gray-400">Tipo de tarea<select value={action.task_type} onChange={event => { const value = event.target.value; if (isTaskType(value)) setAction(index, { ...action, task_type: value }) }} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800">{TASK_TYPES.map(type => <option key={type.value} value={type.value}>{type.label}</option>)}</select></label><label className="grid gap-1 text-[10px] text-gray-500 dark:text-gray-400 md:col-span-3">Descripción<input maxLength={1000} value={action.description ?? ''} onChange={event => setAction(index, { ...action, description: event.target.value })} placeholder="Opcional" className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800" /></label><label className="grid gap-1 text-[10px] text-gray-500 dark:text-gray-400">Vence en minutos<input type="number" min={1} max={43200} value={action.due_minutes} onChange={event => setAction(index, { ...action, due_minutes: Number(event.target.value) })} className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800" /></label><label className="grid gap-1 text-[10px] text-gray-500 dark:text-gray-400">Recordar antes (min)<input type="number" min={0} value={action.remind_minutes_before} onChange={event => setAction(index, { ...action, remind_minutes_before: Number(event.target.value) })} className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800" /></label><label className="grid gap-1 text-[10px] text-gray-500 dark:text-gray-400">Responsable<select value={action.assigned_user_id ?? ''} onChange={event => setAction(index, { ...action, assigned_user_id: event.target.value ? Number(event.target.value) : null })} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="">Vendedor del lead</option>{activeUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select></label><label className="grid gap-1 text-[10px] text-gray-500 dark:text-gray-400">Prioridad<select value={action.priority} onChange={event => { const value = event.target.value; if (isTaskPriority(value)) setAction(index, { ...action, priority: value }) }} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value={TaskPriorityValue.Low}>Baja</option><option value={TaskPriorityValue.Normal}>Normal</option><option value={TaskPriorityValue.High}>Alta</option></select></label></div>}
            {action.type === ActionType.AssignSeller && <select required value={action.user_id ?? ''} onChange={event => setAction(index, { ...action, user_id: Number(event.target.value) || null })} className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="">Selecciona vendedor</option>{activeUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}
            {(action.type === ActionType.AddTag || action.type === ActionType.RemoveTag) && <select required value={action.tag_id ?? ''} onChange={event => setAction(index, { ...action, tag_id: Number(event.target.value) || null })} className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="">Selecciona etiqueta</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</select>}
            {action.type === ActionType.ChangeStage && <select value={action.stage} onChange={event => { const value = event.target.value; if (isLeadStage(value)) setAction(index, { ...action, stage: value }) }} className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800">{LEAD_STAGES.map(stage => <option key={stage} value={stage}>{stage}</option>)}</select>}
            {action.type === ActionType.Notify && <div className="grid gap-2 md:grid-cols-2"><select value={action.recipient} onChange={event => setAction(index, { ...action, recipient: event.target.value === AutomationRecipient.Specific ? AutomationRecipient.Specific : AutomationRecipient.Seller, user_id: null })} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value={AutomationRecipient.Seller}>Vendedor del lead</option><option value={AutomationRecipient.Specific}>Usuario específico</option></select>{action.recipient === AutomationRecipient.Specific && <select required value={action.user_id ?? ''} onChange={event => setAction(index, { ...action, user_id: Number(event.target.value) || null })} className="rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="">Selecciona usuario</option>{activeUsers.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</select>}<input required maxLength={160} value={action.title} onChange={event => setAction(index, { ...action, title: event.target.value })} placeholder="Título" className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800 md:col-span-2" /><textarea required maxLength={1000} rows={2} value={action.body} onChange={event => setAction(index, { ...action, body: event.target.value })} placeholder="Contenido de la notificación" className="rounded-lg border border-gray-200 px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800 md:col-span-2" /></div>}
            {action.type === ActionType.SendTemplate && <div><select required value={action.template_id ?? ''} onChange={event => setAction(index, { ...action, template_id: Number(event.target.value) || null })} className="w-full rounded-lg border border-gray-200 bg-white px-2.5 py-2 text-xs dark:border-gray-700 dark:bg-gray-800"><option value="">Selecciona plantilla de texto</option>{automaticTemplates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</select><p className="mt-1 text-[10px] text-amber-700 dark:text-amber-300">Solo se envía con la ventana de 24 horas abierta. Se admiten adjuntos (imagen, video, audio, documento); no se admiten plantillas con botones o listas.</p></div>}
          </div>)}</div></section>

          <div className="rounded-xl bg-gray-50 px-3 py-2.5 text-[11px] text-gray-500 dark:bg-gray-800/60">Variables disponibles: {'{{nombre}}'}, {'{{telefono}}'}, {'{{servicio}}'}, {'{{vendedor}}'}, {'{{fecha_actual}}'}. Las acciones se detienen si una falla y el motivo queda en el historial.</div>
          {error && <div className="whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-gray-200 px-5 py-3.5 dark:border-gray-800"><label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />Activar al guardar</label><div className="flex gap-2"><button type="button" onClick={closeForm} className="rounded-lg px-3 py-2 text-sm text-gray-500">Cancelar</button><button disabled={isSaving} className="flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">{isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar regla</button></div></footer>
      </form></div>}
      {flowBuilder && <VisualFlowBuilder rule={flowBuilder.rule} onClose={() => setFlowBuilder(null)} />}
    </div>
  )
}
