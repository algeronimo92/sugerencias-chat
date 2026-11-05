import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useMe } from '../../../shared/auth'
import { useCustomFields } from '../../catalogs/public/useCustomFields'
import { useSellers } from '../../platform/public/useUsers'
import { leadCorrections, leadUpdatesFor, prefillFromLead, type LeadCorrection, type LeadSnapshot } from '../domain/leadPrefill'
import { loadAppointmentDraft, useAppointmentForm } from './useAppointmentForm'

// Un borrador por lead: el de un cliente no aparece al agendar a otro.
const leadDraftKey = (leadId: string) => `nueva-cita-lead-draft:${leadId}`

/**
 * Cita agendada desde la ficha del lead: prellena el formulario con el lead
 * (o con el borrador de ese lead), exige confirmar lo tomado del lead y, si
 * el vendedor corrigió algo, pasa por el paso de elegir qué llevar al lead.
 */
export function useLeadAppointment(lead: LeadSnapshot, leadReady: boolean, onSaved: () => void) {
  const draftKey = leadDraftKey(lead.id)
  const state = useAppointmentForm(draftKey)
  const { load } = state
  const { data: me } = useMe()
  const { data: sellers = [], isLoading: sellersLoading } = useSellers()
  const { data: leadFields = [] } = useCustomFields('lead')
  const [confirmed, setConfirmed] = useState(false)
  const [corrections, setCorrections] = useState<LeadCorrection[] | null>(null)
  const [chosen, setChosen] = useState<Set<string>>(new Set())
  const [prefilled, setPrefilled] = useState<ReadonlySet<string>>(new Set())
  const loaded = useRef(false)

  const ready = leadReady && !sellersLoading && !state.customFieldsLoading
  const prefill = useMemo(
    () => (ready ? prefillFromLead(lead, state.definitions, sellers, me?.name ?? null) : null),
    [ready, lead, state.definitions, sellers, me?.name],
  )

  useEffect(() => {
    if (!prefill || loaded.current) return
    loaded.current = true
    setPrefilled(prefill.prefilled)
    // Un borrador de este mismo lead manda: el vendedor ya había empezado.
    const draft = loadAppointmentDraft(draftKey)
    if (draft) load({ ...draft.form, telefono: prefill.form.telefono }, draft.customFields)
    else load(prefill.form, prefill.customFields)
  }, [prefill, draftKey, load])

  const needsConfirmation = prefilled.size > 0
  const canSave = ready && (!needsConfirmation || confirmed) && !state.busy && !state.customFieldsError

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    const problem = state.validate()
    if (problem) { state.setError(problem); return }
    if (corrections === null) {
      const found = leadCorrections(lead, state.form, state.customFields, leadFields)
      if (found.length > 0) {
        setCorrections(found)
        setChosen(new Set(found.map(correction => correction.key)))
        return
      }
    }
    const leadUpdates = corrections ? leadUpdatesFor(corrections, chosen) : null
    void state.submit({ leadId: lead.id, leadUpdates, onSuccess: onSaved })
  }

  function toggle(key: string, checked: boolean) {
    setChosen(current => {
      const next = new Set(current)
      if (checked) next.add(key)
      else next.delete(key)
      return next
    })
  }

  return {
    state, ready, prefilled, needsConfirmation, confirmed, setConfirmed, canSave,
    corrections, chosen, toggle, backToForm: () => setCorrections(null), handleSubmit,
  }
}

export type LeadAppointmentState = ReturnType<typeof useLeadAppointment>
