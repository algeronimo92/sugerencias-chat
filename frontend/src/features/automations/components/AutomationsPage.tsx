import { getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import {
AlertTriangle,Ban,Bot,CheckCircle2,ChevronDown,Clock3,Copy,
FileJson,GitBranch,History,Loader2,LocateFixed,MessageCircle,Pencil,Plus,RotateCcw,ShieldCheck,
Send,Trash2,XCircle,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { ErrorState } from '../../../shared/ui/EmptyState'
import { Select } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useTags } from '../../catalogs/public/useTags'
import { useLeadStageCatalog } from '../../leads/public/useLeadStages'
import { useUsers } from '../../platform/public/useUsers'
import { AutomationExecutionStatus, AutomationTrigger as TriggerType, automationStepLabel, isServiceWindowFailure } from '../domain/automationCatalog'
import {
useAttention,useAutomationExecutions,useAutomationExecutionsCount,useAutomationRules,useCancelExecution,useCreateVisualFlow,
useDeleteAutomation,useDuplicateAutomation,useRetryExecution,useUpdateAutomation,
} from '../queries'
import type {
AutomationActionResult,AutomationExecution,
AutomationFlowDefinition,AutomationRule,
} from '../types'
import { EXECUTION_OUTCOME_LABELS, stepStatusLabel, executionLeadLabel, executionOriginLabel, executionOutcome, executionStatusLabel, executionTone, executionTriggerLabel, formatExecutionDate as formatDate, isExecutionOutcome, outcomeFilter, readableExecutionError, stepResultDetail, type ExecutionOutcomeValue, type StepLookups } from '../utils/automationExecutions'
import { EXECUTIONS_MAX_LIMIT, EXECUTIONS_PAGE_LIMIT } from '../api'
import { AttentionPanel } from './AttentionPanel'
import { RecipePicker } from './RecipePicker'
import { MessageMarks } from './MessageMarks'
import type { FlowStarter } from '../domain/flowRecipes'
import { todayISODate } from '../../../shared/utils/datetime'
import { areFlowDefinitionsEqual, launchersByRule } from '../utils/automationFlow'
import { ImportFlowJsonDialog } from './ImportFlowJsonDialog'
import { VisualFlowBuilder } from './VisualFlowBuilder'
import type { ServiceHighlight } from './ServiceHighlightNotice'
import { useRuleUrl } from '../hooks/useRuleUrl'

const triggerLabel = executionTriggerLabel

function actionLabel(value: AutomationActionResult['type']) {
  return automationStepLabel(value)
}

type AutomationsTab = 'attention' | 'flows' | 'activity'
// Cómo empieza: lo único que distingue a una automatización de otra en la lista.
type StartFilter = 'all' | 'automatic' | 'team'

// Qué responde cada sección, en una línea, arriba de su contenido.
const SECTION_COPY: Record<AutomationsTab, { title: string; hint: string }> = {
  attention: { title: 'Por atender', hint: 'Lo que no salió como debía y espera una decisión. Cuando esta lista está vacía, todo marcha.' },
  flows: { title: 'Tus automatizaciones', hint: 'Todas en un solo lugar. Unas empiezan solas cuando pasa algo y otras las lanza tu equipo desde el chat: es lo único que cambia entre ellas.' },
  activity: { title: 'Actividad', hint: 'Todo lo que corrió, con su resultado.' },
}

const TABS: { key: AutomationsTab; label: string; icon: typeof History }[] = [
  { key: 'attention', label: 'Por atender', icon: AlertTriangle },
  { key: 'flows', label: 'Tus automatizaciones', icon: GitBranch },
  { key: 'activity', label: 'Actividad', icon: History },
]

export function AutomationsPage() {
  const navigate = useNavigate()
  const { data: rules = [], isLoading, isError, refetch } = useAutomationRules()
  // Un fallo de carga se veía igual que «todavía no hay automatizaciones».
  const rulesError = isError && rules.length === 0 ? (
    <ErrorState
      title="No se pudieron cargar las automatizaciones"
      description="Siguen guardadas: lo que falló fue la carga. Revisa tu conexión y vuelve a intentar."
      action={<Button variant="secondary" onClick={() => void refetch()}>Reintentar</Button>}
    />
  ) : null
  const [historyRuleId, setHistoryRuleId] = useState<number | null>(null)
  const [historyStatus, setHistoryStatus] = useState<ExecutionOutcomeValue | null>(null)
  const [hideSkipped, setHideSkipped] = useState(true)
  // Toggle rápido activo/finalizado/todos. Es mutuamente excluyente con el
  // selector de estado puntual: elegir uno limpia el otro para que no
  // compitan (el backend igual le da precedencia al status puntual).
  const [historyActive, setHistoryActive] = useState<boolean | null>(null)
  const [historyDateFrom, setHistoryDateFrom] = useState(todayISODate)
  const [historyDateTo, setHistoryDateTo] = useState(todayISODate)
  const excludeSkipped = hideSkipped && historyStatus !== AutomationExecutionStatus.Skipped
  const historyFilters = {
    ruleId: historyRuleId ?? undefined,
    // «Completada», «Enviando…» y «No se entregó» son el mismo estado del
    // motor con distinta entrega: el filtro pide lo que la etiqueta muestra.
    ...(historyStatus ? outcomeFilter(historyStatus) : {}),
    excludeSkipped,
    active: historyActive ?? undefined,
    dateFrom: historyDateFrom,
    dateTo: historyDateTo,
  }
  // Cuántas se piden. Vuelve a una página cuando cambian los filtros: lo
  // cargado de más era de otra búsqueda.
  const historyFilterKey = JSON.stringify(historyFilters)
  const [historyPaging, setHistoryPaging] = useState({ key: historyFilterKey, limit: EXECUTIONS_PAGE_LIMIT })
  const historyLimit = historyPaging.key === historyFilterKey ? historyPaging.limit : EXECUTIONS_PAGE_LIMIT
  const { data: executions = [], isLoading: executionsLoading, isFetching: executionsFetching } = useAutomationExecutions({ ...historyFilters, limit: historyLimit })
  const { data: historyTotal } = useAutomationExecutionsCount(historyFilters)
  const { data: users = [] } = useUsers(true)
  const { data: tags = [] } = useTags()
  const createVisualFlow = useCreateVisualFlow()
  const update = useUpdateAutomation()
  const duplicate = useDuplicateAutomation()
  const deleteAutomation = useDeleteAutomation()
  const retryExecution = useRetryExecution()
  const cancelExecution = useCancelExecution()
  // `?tab=history` existe para el enlace "Ver flujos automáticos" de "Flujos
  // enviados": sin él, quien llegaba buscando el historial caía en Reglas.
  const [searchParams] = useSearchParams()
  const [chosenTab, setTab] = useState<AutomationsTab | null>(() => searchParams.get('tab') === 'history' ? 'activity' : null)
  const [flowBuilder, setFlowBuilder] = useState<{ rule?: AutomationRule; highlight?: ServiceHighlight; block?: string; starter?: FlowStarter } | null>(null)
  // Crear empieza por elegir qué se quiere lograr, no por un lienzo en blanco.
  const [recipePickerOpen, setRecipePickerOpen] = useState(false)
  // Qué ejecuciones tienen el detalle abierto: solo esas piden las marcas de sus mensajes.
  const [openExecutions, setOpenExecutions] = useState<ReadonlySet<number>>(new Set())
  const [importFlowOpen, setImportFlowOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stageCatalog = useLeadStageCatalog()
  // Para decir «a la etapa Agendado» o «a Ana» en el detalle de un paso, en vez de ids.
  const stepLookups = useMemo<StepLookups>(() => ({
    stageName: key => stageCatalog.label(key),
    userName: id => users.find(user => user.id === id)?.name,
    tagName: id => tags.find(tag => tag.id === id)?.name,
  }), [stageCatalog, users, tags])
  const historyColumns = useMemo<ColumnDef<AutomationExecution>[]>(() => [
    { id: 'rule', accessorFn: execution => execution.rule_name },
    { id: 'lead', accessorFn: execution => executionLeadLabel(execution) },
    { id: 'status', accessorFn: execution => execution.status },
    { id: 'createdAt', accessorFn: execution => execution.created_at },
  ], [])
  const executionTable = useReactTable({ data: executions, columns: historyColumns, getCoreRowModel: getCoreRowModel() })
  // Un flujo borrado ya no está en la lista: "Ver en el flujo" solo va a los que siguen.
  const visualRuleIds = new Set(rules.map(rule => rule.id))
  // Estaban en dos secciones («Empiezan solas» y «Las lanza tu equipo») y se
  // leían como dos cosas distintas, cuando es la misma con otro inicio: al
  // cambiarle el inicio a una, desaparecía de la lista donde estaba. Ahora es
  // una lista con una etiqueta por tarjeta y un filtro.
  // Una automatización que lanza a otra («Bienvenida» a las de cada servicio)
  // no se veía en ningún lado: había que abrir el editor de cada una.
  const launchers = useMemo(() => launchersByRule(rules), [rules])
  const [startFilter, setStartFilter] = useState<StartFilter>('all')
  const teamCount = rules.filter(rule => rule.trigger_type === TriggerType.Manual).length
  const startCounts: Record<StartFilter, number> = { all: rules.length, automatic: rules.length - teamCount, team: teamCount }
  const shownFlows = startFilter === 'all' ? rules : rules.filter(rule => (rule.trigger_type === TriggerType.Manual) === (startFilter === 'team'))
  const attention = useAttention()
  // Se entra donde hay algo que decidir: en «Por atender» si hay pendientes
  // y, si no, en lo que más se edita. Se decide una vez, al terminar de
  // cargar: descartar el último aviso no debe mover a la persona de sección.
  const [landingTab, setLandingTab] = useState<AutomationsTab | null>(null)
  if (landingTab === null && !attention.isLoading) setLandingTab(attention.count > 0 ? 'attention' : 'flows')
  const tab: AutomationsTab = chosenTab ?? landingTab ?? 'flows'
  // Hasta saber si hay pendientes no se dibuja ninguna sección: mostrar una y
  // saltar a otra medio segundo después desorienta.
  const landingUndecided = chosenTab === null && landingTab === null
  // Sin total todavía (o con un backend anterior) vale la señal de siempre:
  // la lista llegó llena.
  const historyTruncated = historyTotal !== undefined ? executions.length < historyTotal : executions.length >= historyLimit
  const canLoadMore = historyTruncated && historyLimit < EXECUTIONS_MAX_LIMIT
  const today = todayISODate()
  const hasCustomHistoryFilters = historyRuleId !== null || historyStatus !== null || !hideSkipped
    || historyActive !== null || historyDateFrom !== today || historyDateTo !== today

  function resetHistoryFilters() {
    setHistoryRuleId(null)
    setHistoryStatus(null)
    setHideSkipped(true)
    setHistoryActive(null)
    setHistoryDateFrom(today)
    setHistoryDateTo(today)
  }

  function setHistoryStatusFilter(value: ExecutionOutcomeValue | null) {
    setHistoryStatus(value)
    if (value !== null) setHistoryActive(null)
  }

  function setHistoryActiveFilter(value: boolean | null) {
    setHistoryActive(value)
    if (value !== null) setHistoryStatus(null)
  }

  function openExecutionChat(leadId: string | null) {
    if (leadId) navigate(`/chat/${encodeURIComponent(leadId)}`)
  }

  // La URL dice qué automatización está abierta (?automatizacion=<id>, y el
  // realce si viene de Catálogos). Se abre al renderizar, no en un efecto, y
  // una vez por valor: abrir o cerrar desde la lista solo cambia la URL.
  const ruleUrl = useRuleUrl(rules, isLoading)
  const [shownRule, setShownRule] = useState<string | null>(null)
  if (!isLoading && ruleUrl.key !== shownRule) {
    setShownRule(ruleUrl.key)
    const { rule, highlight, block } = ruleUrl
    if (rule) { setTab('flows'); setFlowBuilder({ rule, highlight: highlight ?? undefined, block: block ?? undefined }) }
  }

  async function importFlow(flowDefinition: AutomationFlowDefinition, name: string) {
    const created = await createVisualFlow.mutateAsync({ name, flow_definition: flowDefinition })
    toast.success('Automatización importada')
    setFlowBuilder({ rule: created })
  }

  function toggleRule(rule: AutomationRule) {
    setError(null)
    update.mutate(
      { id: rule.id, is_active: !rule.is_active },
      { onSuccess: () => toast.success(rule.is_active ? 'Automatización pausada' : 'Automatización activada'), onError: reason => setError(extractErrorMessage(reason)) },
    )
  }

  function duplicateRule(rule: AutomationRule) {
    setError(null)
    duplicate.mutate(rule.id, { onSuccess: () => toast.success('Automatización duplicada'), onError: reason => setError(extractErrorMessage(reason)) })
  }

  function deleteRule(rule: AutomationRule) {
    setError(null)
    deleteAutomation.mutate(rule.id, {
      onSuccess: () => toast.success('Automatización eliminada; el historial se conservó'),
      onError: reason => setError(extractErrorMessage(reason)),
    })
  }

  // Pausar pide confirmación: era un clic a 4 px de «Eliminar» y corta lo que
  // está en curso (el motor omite la ejecución al despertar si la regla ya no
  // está activa; en DermicaPro eso ya había cancelado 12). Reanudar no rompe
  // nada, así que sigue siendo directo.
  function toggleControl(rule: AutomationRule) {
    const isUpdating = update.isPending && update.variables?.id === rule.id
    const label = isUpdating ? 'Actualizando…' : rule.is_active ? 'Pausar' : 'Reanudar'
    // Un interruptor y no un icono de encendido: dice el estado sin tener
    // que interpretar un color, y es el control que la gente ya asocia a
    // «prendido / apagado».
    const button = (
      <button
        type="button"
        role="switch"
        aria-checked={rule.is_active}
        disabled={update.isPending}
        aria-busy={isUpdating}
        aria-label={`${label} ${rule.name}`}
        title={label}
        onClick={rule.is_active ? undefined : () => toggleRule(rule)}
        className={`relative mx-1 inline-flex h-6 w-10 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-50 ${rule.is_active ? 'bg-accent-fill' : 'bg-line-control'}`}
      >
        <span aria-hidden="true" className={`inline-flex h-5 w-5 items-center justify-center rounded-full bg-white shadow transition-transform ${rule.is_active ? 'translate-x-[18px]' : 'translate-x-0.5'}`}>
          {isUpdating && <Loader2 className="h-3 w-3 animate-spin text-fg-muted" />}
        </span>
      </button>
    )
    if (!rule.is_active) return button
    return (
      <ConfirmDialog
        title={`Pausar “${rule.name}”`}
        description="Dejará de iniciarse. Las conversaciones que la tienen en curso no recibirán los pasos que faltan: se cancelan al llegar a su siguiente paso. Puedes reanudarla cuando quieras."
        confirmLabel="Pausar"
        cancelLabel="No pausar"
        disabled={update.isPending}
        onConfirm={() => toggleRule(rule)}
      >
        {button}
      </ConfirmDialog>
    )
  }

  function deleteControl(rule: AutomationRule) {
    const isDeleting = deleteAutomation.isPending && deleteAutomation.variables === rule.id
    return (
      <ConfirmDialog
        title={`Eliminar “${rule.name}”`}
        description={`La automatización dejará de ejecutarse y desaparecerá de esta lista. ${rule.execution_count ? `Sus ${rule.execution_count} ejecuciones y versiones se conservarán en el historial.` : 'No tiene ejecuciones registradas.'}`}
        confirmLabel="Eliminar automatización"
        disabled={deleteAutomation.isPending}
        onConfirm={() => deleteRule(rule)}
      >
        <button
          type="button"
          disabled={deleteAutomation.isPending}
          aria-busy={isDeleting}
          aria-label={isDeleting ? 'Eliminando automatización' : `Eliminar ${rule.name}`}
          title={isDeleting ? 'Eliminando…' : 'Eliminar'}
          className="rounded-lg p-2 text-red-500 hover:bg-red-50 disabled:cursor-wait disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-950/40"
        >
          {isDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
        </button>
      </ConfirmDialog>
    )
  }

  function flowCards(list: AutomationRule[], empty: { title: string; text: string; action: string } | null) {
    if (list.length === 0) {
      return empty && <div className="rounded-2xl border border-dashed border-gray-300 bg-white px-6 py-16 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark"><Bot className="mx-auto h-10 w-10 text-gray-300" /><p className="mt-3 text-sm font-semibold text-gray-700 dark:text-wa-text-dark">{empty.title}</p><p className="mx-auto mt-1 max-w-md text-xs text-wa-muted">{empty.text}</p><button type="button" onClick={() => setRecipePickerOpen(true)} className="mt-4 rounded-lg bg-wa-primary px-3 py-2 text-xs font-semibold text-white"><Plus className="mr-1 inline h-3.5 w-3.5" />{empty.action}</button></div>
    }
    return <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 500px), 1fr))' }}>{list.map(rule => {
            const nodes = 'nodes' in rule.flow_definition ? rule.flow_definition.nodes.length : 0
            const hasPublished = !!rule.published_flow_definition
            const hasDraftChanges = hasPublished && !areFlowDefinitionsEqual(rule.flow_definition, rule.published_flow_definition)
            return <article key={rule.id} className={`rounded-2xl border bg-white p-4 shadow-sm dark:bg-wa-panel-dark ${rule.is_active ? 'border-green-200 dark:border-green-900' : 'border-wa-border dark:border-wa-border-dark'}`}><div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><GitBranch className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div><h2 className="truncate text-sm font-semibold text-wa-text dark:text-white">{rule.name}</h2><p className="mt-0.5 text-[11px] text-wa-muted">{nodes} {nodes === 1 ? 'paso' : 'pasos'}{rule.trigger_type !== TriggerType.Manual && ` · ${triggerLabel(rule.trigger_type)}`}</p>{launchers.get(rule.id) && <p className="mt-0.5 text-[11px] text-wa-muted">También la lanza: {launchers.get(rule.id)!.map(name => `«${name}»`).join(', ')}</p>}<p className="mt-0.5 text-[10px] text-wa-muted">Creada por {rule.created_by_name}</p></div><div className="flex items-center gap-1"><button type="button" onClick={() => ruleUrl.open(rule.id)} title="Abrir el editor" className="rounded-lg p-2 text-wa-muted hover:bg-wa-field hover:text-gray-700 dark:hover:bg-wa-head-dark"><Pencil className="h-3.5 w-3.5" /></button><button type="button" disabled={duplicate.isPending} aria-busy={duplicate.isPending && duplicate.variables === rule.id} onClick={() => duplicateRule(rule)} title={duplicate.isPending && duplicate.variables === rule.id ? 'Duplicando…' : 'Duplicar'} className="rounded-lg p-2 text-wa-muted hover:bg-wa-field hover:text-gray-700 disabled:cursor-wait disabled:opacity-40 dark:hover:bg-wa-head-dark">{duplicate.isPending && duplicate.variables === rule.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Copy className="h-3.5 w-3.5" />}</button>{hasPublished && toggleControl(rule)}{deleteControl(rule)}</div></div><div className="mt-3 flex flex-wrap gap-1.5"><span className="inline-flex items-center gap-1 rounded-full bg-wa-field px-2 py-1 text-[10px] font-semibold text-gray-600 dark:bg-wa-head-dark dark:text-gray-300">{rule.trigger_type === TriggerType.Manual ? <Send className="h-3 w-3" aria-hidden="true" /> : <Bot className="h-3 w-3" aria-hidden="true" />}{rule.trigger_type === TriggerType.Manual ? 'La lanza tu equipo' : 'Empieza sola'}</span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${rule.is_active ? 'bg-green-100 text-wa-primary-strong dark:bg-green-950 dark:text-green-300' : hasPublished ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' : 'bg-wa-field text-gray-600 dark:bg-wa-head-dark dark:text-gray-300'}`}>{rule.is_active ? `Publicada · v${rule.flow_version}` : hasPublished ? 'Pausada' : 'Borrador'}</span>{hasDraftChanges && <span className="rounded-full bg-blue-100 px-2 py-1 text-[10px] font-semibold text-blue-700 dark:bg-blue-950 dark:text-blue-300">Cambios sin publicar</span>}</div><div className="mt-3 flex items-center justify-between border-t border-wa-border pt-3 text-[10px] text-wa-muted dark:border-wa-border-dark"><span>{rule.execution_count} ejecuciones · última {formatDate(rule.last_execution_at)}</span><button type="button" onClick={() => ruleUrl.open(rule.id)} className="font-semibold text-wa-primary-strong">Editar pasos →</button></div></div></div></article>
    })}</div>
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas md:flex-row">
      {/* Secciones en una columna a la izquierda, como Configuración, las
          bandejas del chat y las etapas del embudo: en el celular pasan a ser
          una fila arriba que se desliza. Antes eran pestañas debajo de tres
          contadores que no pedían ninguna acción. */}
      <aside className="flex shrink-0 flex-col border-b border-line bg-surface px-2 pt-4 md:w-60 md:border-b-0 md:border-r md:py-4 lg:w-64">
        <div className="px-3 pb-3">
          <h1 className="text-xl font-semibold text-fg">Automatizaciones</h1>
          <p className="mt-1 hidden text-sm text-fg-muted md:block">Lo que el sistema hace solo y lo que tu equipo lanza con un toque desde el chat.</p>
        </div>
        <nav aria-label="Secciones de automatizaciones" className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
          {TABS.map(({ key, label, icon: Icon }) => {
            const count = { attention: attention.count, flows: rules.length, activity: null }[key]
            const selected = !landingUndecided && tab === key
            return (
              <button key={key} type="button" onClick={() => setTab(key)} aria-current={selected ? 'page' : undefined} className={`flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${selected ? 'bg-selected font-semibold text-fg' : 'text-fg hover:bg-subtle'}`}>
                <Icon className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden="true" />
                <span className="flex-1 whitespace-nowrap text-left">{label}</span>
                {/* Por atender sin pendientes no lleva contador: un «0» ahí se lee como un aviso. */}
                {count !== null && !(key === 'attention' && count === 0) && <span className={`rounded-full px-1.5 py-0.5 text-xs tabular-nums ${key === 'attention' ? 'bg-red-100 font-semibold text-red-700 dark:bg-red-950 dark:text-red-300' : 'text-fg-muted'}`}>{count}</span>}
              </button>
            )
          })}
        </nav>
      </aside>
      <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
      <main className="relative mx-auto max-w-[1100px] px-4 py-6 md:px-8">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-fg">{SECTION_COPY[tab].title}</h2>
            <p className="mt-1 max-w-2xl text-sm text-fg-muted">{SECTION_COPY[tab].hint}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
              {tab === 'flows' && <button type="button" onClick={() => setImportFlowOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-wa-border bg-white/85 px-4 text-sm font-bold text-wa-text shadow-sm transition hover:border-wa-primary/40 hover:bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark/85 dark:text-white"><FileJson className="h-4 w-4" />Importar JSON</button>}
              <button type="button" onClick={() => setRecipePickerOpen(true)} className="inline-flex h-11 items-center gap-2 rounded-xl bg-wa-primary-strong px-4 text-sm font-bold text-white shadow-lg shadow-emerald-950/10 transition hover:-translate-y-0.5 hover:bg-wa-primary"><Plus className="h-4 w-4" />Nueva automatización</button>
          </div>
        </header>

        {error && <div className="mb-4 whitespace-pre-line rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

        {landingUndecided ? (
          <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div>
        ) : tab === 'attention' ? (
          <AttentionPanel groups={attention.groups} isLoading={attention.isLoading} onOpenChat={openExecutionChat} onSeeActivity={() => setTab('activity')} />
        ) : tab === 'flows' ? (
          isLoading ? <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div> : rulesError ?? (
            <div className="space-y-4">
              {rules.length > 0 && (
                <div role="group" aria-label="Filtrar por cómo empiezan" className="flex flex-wrap gap-1.5">
                  {([['all', 'Todas'], ['automatic', 'Empiezan solas'], ['team', 'Las lanza tu equipo']] as const).map(([key, label]) => (
                    <button key={key} type="button" aria-pressed={startFilter === key} onClick={() => setStartFilter(key)} className={`inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-xs outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${startFilter === key ? 'border-transparent bg-selected font-semibold text-fg' : 'border-line text-fg-muted hover:bg-subtle'}`}>
                      {label}<span className="tabular-nums text-fg-muted">{startCounts[key]}</span>
                    </button>
                  ))}
                </div>
              )}
              {rules.length > 0 && shownFlows.length === 0
                ? <p className="rounded-2xl border border-dashed border-line px-6 py-10 text-center text-sm text-fg-muted">{startFilter === 'team' ? 'Ninguna la lanza tu equipo todavía. Se crea eligiendo que empiece con «La lanza tu equipo desde el chat».' : 'Ninguna empieza sola todavía.'}</p>
                : flowCards(shownFlows, { title: 'Todavía no hay automatizaciones', text: 'Lo que el sistema hace solo (dar la bienvenida, hacer seguimiento) y lo que tu equipo lanza con un toque desde el chat (precios, evidencias, indicaciones).', action: 'Crear la primera' })}
            </div>
          )
        ) : (
          <div className="overflow-hidden rounded-2xl border border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <div className="flex flex-wrap items-end gap-3 border-b border-wa-border bg-wa-hover/60 p-3 dark:border-wa-border-dark dark:bg-wa-head-dark/40">
              <label className="grid min-w-48 flex-1 gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Automatización
                <Select value={historyRuleId ?? ''} onChange={event => setHistoryRuleId(event.target.value ? Number(event.target.value) : null)} className="rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark">
                  <option value="">Todas</option>
                  {rules.map(rule => <option key={rule.id} value={rule.id}>{rule.name}</option>)}
                </Select>
              </label>
              <label className="grid min-w-44 flex-1 gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Estado
                <Select value={historyStatus ?? ''} onChange={event => setHistoryStatusFilter(isExecutionOutcome(event.target.value) ? event.target.value : null)} className="rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark">
                  <option value="">Todos los estados</option>
                  {Object.entries(EXECUTION_OUTCOME_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </Select>
              </label>
              <div className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Actividad
                <div className="flex rounded-lg bg-wa-border p-1 dark:bg-wa-head-dark">
                  <button type="button" onClick={() => setHistoryActiveFilter(null)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold normal-case tracking-normal ${historyActive === null ? 'bg-white text-wa-text shadow dark:bg-wa-active-dark dark:text-white' : 'text-wa-muted dark:text-wa-muted-dark'}`}>Todos</button>
                  <button type="button" onClick={() => setHistoryActiveFilter(true)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold normal-case tracking-normal ${historyActive === true ? 'bg-white text-wa-text shadow dark:bg-wa-active-dark dark:text-white' : 'text-wa-muted dark:text-wa-muted-dark'}`}>Activos</button>
                  <button type="button" onClick={() => setHistoryActiveFilter(false)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold normal-case tracking-normal ${historyActive === false ? 'bg-white text-wa-text shadow dark:bg-wa-active-dark dark:text-white' : 'text-wa-muted dark:text-wa-muted-dark'}`}>Finalizados</button>
                </div>
              </div>
              <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Desde
                <input type="date" value={historyDateFrom} max={historyDateTo} onChange={event => setHistoryDateFrom(event.target.value)} className="rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark" />
              </label>
              <label className="grid gap-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted">Hasta
                <input type="date" value={historyDateTo} min={historyDateFrom} onChange={event => setHistoryDateTo(event.target.value)} className="rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs font-normal normal-case tracking-normal text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark" />
              </label>
              <label className={`flex min-h-9 items-center gap-2 rounded-lg border border-wa-border bg-white px-3 py-2 text-xs text-gray-600 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-gray-300 ${historyStatus === AutomationExecutionStatus.Skipped ? 'opacity-50' : ''}`}>
                <Checkbox checked={excludeSkipped} disabled={historyStatus === AutomationExecutionStatus.Skipped} onChange={event => setHideSkipped(event.target.checked)} />
                Ocultar las que no aplicaron
              </label>
              {hasCustomHistoryFilters && <button type="button" onClick={resetHistoryFilters} className="min-h-9 rounded-lg px-3 py-2 text-xs font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/40">Limpiar filtros</button>}
              <span className="ml-auto flex min-h-9 items-center gap-1.5 text-[11px] text-wa-muted">{executionsFetching && <Loader2 className="h-3.5 w-3.5 animate-spin" />}{historyTruncated ? (historyTotal !== undefined ? `${executions.length.toLocaleString('es-PE')} de ${historyTotal.toLocaleString('es-PE')}` : `Las ${executions.length} más recientes`) : `${executions.length} resultados`}</span>
            </div>
            {historyTruncated && <p role="status" className="flex items-start gap-2 border-b border-wa-border bg-amber-50 px-4 py-2.5 text-xs text-amber-800 dark:border-wa-border-dark dark:bg-amber-950/30 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="flex-1">{historyTotal !== undefined ? `Se muestran las ${executions.length.toLocaleString('es-PE')} más recientes de ${historyTotal.toLocaleString('es-PE')}.` : 'Hay más ejecuciones de las que se muestran.'} {canLoadMore ? 'Puedes cargar más o acotar con una automatización, un estado o un rango de fechas más corto.' : 'Para ver el resto, elige una automatización, un estado o un rango de fechas más corto.'}</span>{canLoadMore && <button type="button" disabled={executionsFetching} onClick={() => setHistoryPaging({ key: historyFilterKey, limit: Math.min(historyLimit + EXECUTIONS_PAGE_LIMIT, EXECUTIONS_MAX_LIMIT) })} className="shrink-0 rounded-lg border border-amber-300 bg-white px-2.5 py-1 font-semibold text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-60 dark:border-amber-800 dark:bg-transparent dark:text-amber-100">Cargar {EXECUTIONS_PAGE_LIMIT} más</button>}</p>}
            {executionsLoading ? <div className="flex justify-center px-4 py-16"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div> : executions.length === 0 ? <p className="px-4 py-16 text-center text-sm text-wa-muted">No hay ejecuciones que coincidan con estos filtros.</p> : executionTable.getRowModel().rows.map(({ original: execution }) => (
              <details key={execution.id} onToggle={event => { const open = event.currentTarget.open; setOpenExecutions(current => { const next = new Set(current); if (open) next.add(execution.id); else next.delete(execution.id); return next }) }} className="group border-b border-wa-border last:border-0 dark:border-wa-border-dark">
                <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 hover:bg-wa-hover dark:hover:bg-wa-head-dark/60"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${executionTone(executionOutcome(execution))}`}>{executionOutcome(execution) === AutomationExecutionStatus.Completed ? <CheckCircle2 className="h-4 w-4" /> : (execution.status === AutomationExecutionStatus.Failed || executionOutcome(execution) === 'undelivered') ? <XCircle className="h-4 w-4" /> : execution.status === AutomationExecutionStatus.Skipped ? <AlertTriangle className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}</span><span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-gray-800 dark:text-wa-text-dark">{execution.rule_name}</span><span className="block truncate text-[10px] text-wa-muted">{executionLeadLabel(execution)} · {executionOriginLabel(execution)}{execution.start_source === 'system' ? ` · ${triggerLabel(execution.trigger_type)}` : ''} · {formatDate(execution.created_at)}</span></span><span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${executionTone(executionOutcome(execution))}`}>{executionStatusLabel(executionOutcome(execution))}</span><ChevronDown className="h-4 w-4 text-wa-muted transition-transform group-open:rotate-180" /></summary>
                {execution.rule_deleted && <div className="border-t border-wa-border bg-amber-50 px-4 py-2 text-[11px] text-amber-700 dark:border-wa-border-dark dark:bg-amber-950/30 dark:text-amber-300">Automatización eliminada · historial conservado solo para auditoría.</div>}
                <div className="bg-wa-hover px-4 py-3 text-xs dark:bg-wa-app-dark/60">
                  <p className="text-wa-muted">Programada: {formatDate(execution.scheduled_for)} · Finalizada: {formatDate(execution.finished_at)}</p>
                  {execution.error && <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-700 dark:bg-red-950/40 dark:text-red-300">{readableExecutionError(execution.error)}</p>}
                  <div className="mt-2 space-y-1">{execution.action_results.map((result, index) => <div key={index} className="rounded-lg border border-wa-border bg-white px-3 py-2 dark:border-wa-border-dark dark:bg-wa-panel-dark"><span className="font-semibold">{String(result.position ?? index + 1)}. {actionLabel(result.type)}</span><span className="ml-2 text-wa-muted">{stepStatusLabel(result.status)}{result.error ? ` · ${readableExecutionError(String(result.error))}` : ''}{!result.error && stepResultDetail(result, stepLookups) ? ` · ${stepResultDetail(result, stepLookups)}` : ''}</span>{Array.isArray(result.message_ids) && <MessageMarks executionId={execution.id} messageIds={result.message_ids} enabled={openExecutions.has(execution.id)} />}{result.node_id && visualRuleIds.has(execution.rule_id) && <button type="button" onClick={() => ruleUrl.open(execution.rule_id, String(result.node_id))} title="Abre la automatización en este paso" className="ml-2 inline-flex items-center gap-1 font-semibold text-wa-primary-strong hover:underline dark:text-wa-primary"><LocateFixed className="h-3 w-3" aria-hidden="true" />Ver en la automatización</button>}</div>)}</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {execution.lead_id && <button
                      type="button"
                      onClick={() => openExecutionChat(execution.lead_id)}
                      className="flex items-center gap-1.5 rounded-lg border border-wa-primary-strong px-3 py-1.5 text-[11px] font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/40"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Ir al chat
                    </button>}
                    {!execution.rule_deleted && (execution.status === AutomationExecutionStatus.Failed || execution.status === AutomationExecutionStatus.Skipped) && <button
                      type="button"
                      disabled={retryExecution.isPending}
                      aria-busy={retryExecution.isPending && retryExecution.variables?.id === execution.id}
                      onClick={() => { setError(null); retryExecution.mutate({ id: execution.id }, { onSuccess: () => toast.success('Ejecución reprogramada'), onError: reason => setError(extractErrorMessage(reason)) }) }}
                      className="flex items-center gap-1.5 rounded-lg border border-wa-primary-strong px-3 py-1.5 text-[11px] font-semibold text-wa-primary-strong disabled:cursor-wait disabled:opacity-40 dark:text-wa-primary"
                    >
                      {retryExecution.isPending && retryExecution.variables?.id === execution.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                      {retryExecution.isPending && retryExecution.variables?.id === execution.id ? 'Reintentando…' : 'Reintentar'}
                    </button>}
                    {/* Falló solo por la ventana de 24 h: el admin puede
                        autorizar que esta ejecución la ignore y salga igual. */}
                    {!execution.rule_deleted && execution.status === AutomationExecutionStatus.Failed && isServiceWindowFailure(execution) && <ConfirmDialog
                      title="Enviar con la ventana de 24 horas cerrada"
                      description="Pasaron más de 24 horas desde el último mensaje de este cliente. WhatsApp puede rechazar un mensaje que no sea una plantilla aprobada. Quedará registrado que tú lo autorizaste."
                      confirmLabel="Autorizar y reintentar"
                      cancelLabel="No enviar"
                      confirmVariant="primary"
                      disabled={retryExecution.isPending}
                      onConfirm={() => { setError(null); retryExecution.mutate({ id: execution.id, ignoreServiceWindow: true }, { onSuccess: () => toast.success('Autorizada: se reintenta ignorando la ventana'), onError: reason => setError(extractErrorMessage(reason)) }) }}
                    >
                      <button
                        type="button"
                        disabled={retryExecution.isPending}
                        className="flex items-center gap-1.5 rounded-lg border border-amber-500 px-3 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 disabled:cursor-wait disabled:opacity-40 dark:text-amber-300 dark:hover:bg-amber-950/40"
                      >
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Autorizar y reintentar
                      </button>
                    </ConfirmDialog>}
                    {execution.window_override_at && (
                      <span className="flex items-center gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                        <ShieldCheck className="h-3.5 w-3.5" />
                        Autorizada por {execution.window_override_by_name ?? 'un admin'}
                      </span>
                    )}
                    {!execution.rule_deleted && (execution.status === AutomationExecutionStatus.Scheduled || execution.status === AutomationExecutionStatus.Running || execution.status === AutomationExecutionStatus.Paused) && <ConfirmDialog
                      title={`Cancelar “${execution.rule_name}”`}
                      description={`${execution.lead_name || 'Este lead'} no recibirá los pasos que faltan. No se puede deshacer; para repetirla habría que iniciarla de nuevo.`}
                      confirmLabel="Cancelar ejecución"
                      cancelLabel="No cancelar"
                      disabled={cancelExecution.isPending}
                      onConfirm={() => { setError(null); cancelExecution.mutate(execution.id, { onSuccess: () => toast.success('Ejecución cancelada'), onError: reason => setError(extractErrorMessage(reason)) }) }}
                    >
                      <button
                        type="button"
                        disabled={cancelExecution.isPending}
                        aria-busy={cancelExecution.isPending && cancelExecution.variables === execution.id}
                        className="flex items-center gap-1.5 rounded-lg border border-red-500 px-3 py-1.5 text-[11px] font-semibold text-red-600 disabled:cursor-wait disabled:opacity-40 dark:text-red-400"
                      >
                        {cancelExecution.isPending && cancelExecution.variables === execution.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
                        {cancelExecution.isPending && cancelExecution.variables === execution.id ? 'Cancelando…' : 'Cancelar'}
                      </button>
                    </ConfirmDialog>}
                  </div>
                </div>
              </details>
            ))}
          </div>
        )}
      </main>
      </div>

      {recipePickerOpen && <RecipePicker section={startFilter === 'team' ? 'sequences' : 'automatic'} onClose={() => setRecipePickerOpen(false)} onChoose={starter => { setRecipePickerOpen(false); setFlowBuilder({ starter: starter ?? undefined }) }} />}
      {flowBuilder && <VisualFlowBuilder rule={flowBuilder.rule} highlight={flowBuilder.highlight} initialBlock={flowBuilder.block} starter={flowBuilder.starter} onClose={() => { setFlowBuilder(null); ruleUrl.close() }} />}
      {importFlowOpen && <ImportFlowJsonDialog
        title="Importar automatización desde JSON"
        description="Pega el JSON de una automatización o sube un archivo .json. Se creará como una automatización nueva en borrador; podrás revisarla y publicarla desde el editor."
        confirmLabel="Crear automatización"
        requireNameField
        onClose={() => setImportFlowOpen(false)}
        onImport={importFlow}
      />}
    </div>
  )
}
