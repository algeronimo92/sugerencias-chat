import { CheckCircle2, Loader2, PlugZap } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input, labelClass } from '../../../shared/ui/Input'
import { useErpAppointmentsForm, type ErpAppointmentsForm } from '../hooks/useErpAppointmentsForm'

const mutedClass = 'text-xs text-wa-muted dark:text-wa-muted-dark'
const errorClass = 'text-red-600 dark:text-red-400'

/**
 * Envío de las citas al ERP del negocio, dentro de la tarjeta del ERP: cada
 * cita que se agenda en el CRM aparece en la agenda del ERP con su paciente,
 * su paquete y su adelanto. Para activarlo hay que probar antes la dirección
 * y el token: así no queda encendido algo que rechazaría todas las citas.
 */
export function ErpAppointmentsSection() {
  const form = useErpAppointmentsForm()
  if (form === null) return null

  return (
    <section aria-labelledby="erp-appointments-title" className="border-t border-wa-border pt-4 dark:border-wa-border-dark">
      <h3 id="erp-appointments-title" className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Citas en la agenda del ERP</h3>
      <p className={`mt-1 ${mutedClass}`}>
        Cada cita que se agenda acá aparece en la agenda del ERP con su paciente, su paquete y su adelanto.
        El formulario de cita pasa a pedir el DNI, el paquete y el método de pago del adelanto.
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm text-wa-text dark:text-wa-text-dark">
        <Checkbox checked={form.draft.enabled} onCheckedChange={form.setEnabled} disabled={form.saving} />
        Enviar las citas al ERP
      </label>

      <ConnectionFields form={form} />
      <Actions form={form} />
      <TestOutcome form={form} />
    </section>
  )
}

function ConnectionFields({ form }: { form: ErpAppointmentsForm }) {
  const tokenPlaceholder = form.tokenConfigured ? 'Guardado · escribe para cambiarlo' : 'El mismo que se configuró en el ERP'
  return (
    <div className="mt-3 grid gap-3 sm:grid-cols-2">
      <div>
        <label htmlFor="erp-appointments-url" className={labelClass}>Dirección del ERP</label>
        <Input id="erp-appointments-url" type="url" inputMode="url" value={form.draft.url} onChange={event => form.setUrl(event.target.value)} placeholder="https://mi-erp.com" />
      </div>
      <div>
        <label htmlFor="erp-appointments-token" className={labelClass}>Token de la integración</label>
        <Input
          id="erp-appointments-token" type="password" autoComplete="off" value={form.draft.token}
          onChange={event => form.setToken(event.target.value)} placeholder={tokenPlaceholder}
          aria-describedby="erp-appointments-token-hint"
        />
        <p id="erp-appointments-token-hint" className={`mt-1 ${mutedClass}`}>
          Es el valor de CRM_INTEGRATION_TOKEN en el ERP. No se vuelve a mostrar.
        </p>
      </div>
    </div>
  )
}

function Actions({ form }: { form: ErpAppointmentsForm }) {
  const TestIcon = form.testing ? Loader2 : PlugZap
  return (
    <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
      <Button variant="secondary" className="h-11 sm:h-9" onClick={form.runTest} disabled={!form.canTest} aria-busy={form.testing}>
        <TestIcon className={`h-4 w-4 ${form.testing ? 'animate-spin' : ''}`} aria-hidden="true" />
        {form.testing ? 'Probando…' : 'Probar conexión'}
      </Button>
      <Button className="h-11 sm:h-9" onClick={form.saveChanges} disabled={!form.canSave}>
        {form.saving && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
        Guardar
      </Button>
      {form.mustTest && <span className={mutedClass}>Prueba la conexión antes de guardar.</span>}
    </div>
  )
}

function TestOutcome({ form }: { form: ErpAppointmentsForm }) {
  const failure = form.testError ?? (form.testResult?.ok === false ? form.testResult.error : null)
  return (
    <div className="mt-2 min-h-5 text-xs" aria-live="polite">
      {form.testResult?.ok && (
        <p className="flex items-center gap-1 text-wa-primary-strong dark:text-wa-primary">
          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> El ERP respondió: la dirección y el token son correctos.
        </p>
      )}
      {failure && <p role="alert" className={errorClass}>{failure}</p>}
    </div>
  )
}
