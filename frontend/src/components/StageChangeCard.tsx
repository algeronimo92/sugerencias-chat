import { useState } from 'react'
import { ArrowRight, GitCommitHorizontal } from 'lucide-react'
import type { LeadActivity, LeadStage } from '../types'
import { LEAD_STAGE_META } from '../domain/leadStageMeta'
import { formatMessageTime, parseContent } from '../utils/message'
import { Button } from './ui'

// Metadata que guarda el backend junto al cambio de estado (ver
// services/db_service.py:update_lead_stage): la foto del último mensaje del
// cliente al momento del cambio y, si lo movió el agente IA, su análisis.
interface TriggerMessage {
  id?: number
  content?: string
  sent_at?: string
}

function StageBadge({ stage }: { stage: string }) {
  const meta = LEAD_STAGE_META[stage as LeadStage]
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold ${meta?.badge ?? 'bg-wa-field text-gray-700 dark:bg-wa-active-dark dark:text-gray-300'}`}>
      {meta && <span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />}
      {meta?.label ?? stage.replaceAll('_', ' ')}
    </span>
  )
}

function actorLabel(activity: LeadActivity): string {
  if (activity.actor_name) return activity.actor_name
  if (activity.actor_type === 'agent') return 'Agente IA'
  if (activity.metadata?.automation_rule_id != null) return 'Automatización'
  if (activity.actor_type === 'n8n') return 'n8n'
  return 'Sistema'
}

/** Evento de cambio de estado renderizado dentro del hilo del chat, en la
 * posición cronológica en que ocurrió: muestra de dónde a dónde se movió el
 * lead, quién lo movió, qué dijo el cliente en ese momento y la razón. */
export function StageChangeCard({ activity }: { activity: LeadActivity }) {
  const [expanded, setExpanded] = useState(false)
  const oldStage = typeof activity.old_value?.stage === 'string' ? activity.old_value.stage : null
  const newStage = typeof activity.new_value?.stage === 'string' ? activity.new_value.stage : null
  const reason = typeof activity.metadata?.reason === 'string' ? activity.metadata.reason : null
  const trigger = (activity.metadata?.trigger_message ?? null) as TriggerMessage | null
  const triggerParsed = trigger?.content ? parseContent(trigger.content) : null
  // Las razones del agente IA pueden ser un análisis largo: colapsadas por
  // defecto, se expanden con un toque en la tarjeta.
  const isLongReason = (reason?.length ?? 0) > 140

  if (!newStage) return null

  return (
    <div className="my-2 flex justify-center">
      <div className="max-w-[85%] rounded-xl border border-wa-border bg-white px-3.5 py-2 text-center shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark">
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          <GitCommitHorizontal className="h-3.5 w-3.5 text-wa-muted dark:text-wa-muted-dark" />
          {oldStage && <StageBadge stage={oldStage} />}
          {oldStage && <ArrowRight className="h-3 w-3 text-wa-faint dark:text-wa-muted-dark" />}
          <StageBadge stage={newStage} />
        </div>
        <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
          Movido por {actorLabel(activity)} · {formatMessageTime(activity.created_at)}
        </p>
        {triggerParsed && (triggerParsed.text || triggerParsed.label) && (
          <p className="mx-auto mt-1.5 max-w-prose border-l-2 border-wa-primary/50 pl-2 text-left text-[11px] italic leading-relaxed text-gray-600 dark:text-gray-300">
            {triggerParsed.kind === 'text'
              ? `«${triggerParsed.text}»`
              : `${triggerParsed.label}${triggerParsed.text ? ` · «${triggerParsed.text}»` : ''}`}
          </p>
        )}
        {reason && (
          <p className={`mx-auto mt-1.5 max-w-prose text-left text-[11px] leading-relaxed text-wa-muted dark:text-wa-muted-dark ${!expanded && isLongReason ? 'line-clamp-2' : ''}`}>
            {reason}
          </p>
        )}
        {isLongReason && (
          <Button variant="ghost" size="sm" className="mt-1 !h-6 text-[11px]" onClick={() => setExpanded((v) => !v)}>
            {expanded ? 'Ver menos' : 'Ver razón completa'}
          </Button>
        )}
      </div>
    </div>
  )
}
