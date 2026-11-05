import { CalendarDays, CalendarPlus, CheckCircle2, FileText, FlaskConical, History, Info, Loader2, Save } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { useMe } from '../../../shared/auth'
import { Button } from '../../../shared/ui/Button'
import { appointmentResultMessage, loadAppointmentDraft, useAppointmentForm } from '../hooks/useAppointmentForm'
import { AppointmentCalendar } from './AppointmentCalendar'
import { AppointmentFormFields } from './AppointmentFormFields'
import { AppointmentHistoryList } from './AppointmentHistoryList'

const tabClass = (active: boolean) =>
  `inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong ${active ? 'bg-wa-panel text-wa-primary-strong dark:bg-wa-active-dark dark:text-wa-primary' : 'text-wa-muted hover:bg-wa-hover dark:hover:bg-wa-hover-dark'}`
type Tab = 'form' | 'calendar' | 'history'
const DRAFT_KEY = 'nueva-cita-draft-v2'

export function NewAppointmentPage() {
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const state = useAppointmentForm(DRAFT_KEY)
  const { load } = state
  const [testMode, setTestMode] = useState(false)
  const [draftRestored, setDraftRestored] = useState(false)
  const [tab, setTab] = useState<Tab>('form')

  useEffect(() => {
    const draft = loadAppointmentDraft(DRAFT_KEY)
    if (draft) { load(draft.form, draft.customFields); setDraftRestored(true) }
  }, [load])

  function resetForm() { state.reset(); setDraftRestored(false) }

  function submit(event: FormEvent) {
    event.preventDefault()
    void state.submit({ testMode: isAdmin && testMode, onSuccess: () => setDraftRestored(false) })
  }

  const busy = state.busy
  const feedback = state.result ? appointmentResultMessage(state.result) : null
  const error = state.error
  const title = tab === 'form' ? 'Nueva cita' : tab === 'calendar' ? 'Calendario' : 'Historial de citas'

  return (
    <main className="h-full overflow-x-hidden overflow-y-auto bg-wa-app text-wa-text dark:bg-wa-app-dark dark:text-wa-text-dark">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-wa-primary-strong"><CalendarPlus className="h-4 w-4" />Agenda del negocio</div><h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1><p className="mt-2 text-sm text-wa-muted">Las reservas quedan guardadas en la app; Google Calendar y otros conectores son opcionales.</p></div>
            {isAdmin && tab === 'form' && <label className="flex min-h-11 items-center gap-3 rounded-lg border border-wa-border bg-wa-panel px-3 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark"><FlaskConical className="h-4 w-4" />Modo prueba<input type="checkbox" checked={testMode} onChange={event => setTestMode(event.target.checked)} /></label>}
          </div>
          <nav className="mt-6 flex items-center gap-1 overflow-x-auto rounded-xl bg-wa-field p-1 dark:bg-wa-field-dark" aria-label="Secciones de citas">
            <button type="button" onClick={() => setTab('form')} className={tabClass(tab === 'form')}><CalendarPlus className="h-3.5 w-3.5" />Nueva cita</button>
            <button type="button" onClick={() => setTab('calendar')} className={tabClass(tab === 'calendar')}><CalendarDays className="h-3.5 w-3.5" />Calendario</button>
            <button type="button" onClick={() => setTab('history')} className={tabClass(tab === 'history')}><History className="h-3.5 w-3.5" />Historial</button>
          </nav>
        </header>

        <div className="mt-6">
          {tab === 'calendar' ? <AppointmentCalendar /> : tab === 'history' ? <div className="rounded-xl border border-wa-border bg-wa-panel p-4 sm:p-6 dark:border-wa-border-dark dark:bg-wa-panel-dark"><AppointmentHistoryList /></div> : (
            <form onSubmit={submit} className="space-y-5">
              {draftRestored && <div className="flex items-center justify-between rounded-lg border border-wa-accent/30 bg-wa-accent/10 px-4 py-3 text-sm"><span className="flex gap-2"><FileText className="h-4 w-4" />Borrador restaurado</span><button type="button" className="font-semibold underline" onClick={resetForm}>Descartar</button></div>}
              {feedback && <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${feedback.tone === 'info' ? 'border-amber-400/40 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300' : 'border-green-500/30 bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-300'}`}><CheckCircle2 className="mr-2 inline h-4 w-4" />{feedback.text}</div>}
              {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-50 px-4 py-3 text-sm text-red-700"><Info className="mr-2 inline h-4 w-4" />{error}</div>}

              <AppointmentFormFields state={state} />

              <div className="flex flex-col-reverse gap-2 rounded-xl border border-wa-border bg-wa-panel p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:flex-row sm:justify-end"><Button type="button" variant="secondary" onClick={() => { if (state.saveDraft()) setDraftRestored(true) }} disabled={busy}><Save className="h-4 w-4" />Guardar borrador</Button><Button type="submit" disabled={busy || state.customFieldsLoading || state.customFieldsError}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}{busy ? 'Guardando…' : 'Guardar cita'}</Button></div>
            </form>
          )}
        </div>
      </div>
    </main>
  )
}

