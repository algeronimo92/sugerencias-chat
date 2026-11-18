import { CheckCircle2, Loader2, PlugZap } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useErpAppointmentsConfig, useSaveErpAppointmentsConfig, useTestErpAppointments } from '../queries'

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(value.trim())
}

/**
 * Envío de las citas al ERP del negocio, dentro de la tarjeta del ERP: cada
 * cita que se agenda en el CRM aparece en la agenda del ERP con su paciente,
 * su paquete y su adelanto. Para activarlo hay que probar antes la dirección
 * y el token: así no queda encendido algo que rechazaría todas las citas.
 */
export function ErpAppointmentsSection() {
  const { data: config, isLoading } = useErpAppointmentsConfig()
  const save = useSaveErpAppointmentsConfig()
  const test = useTestErpAppointments()
  // null: todavía no se tocó, vale lo guardado.
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null)
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [testedKey, setTestedKey] = useState<string | null>(null)

  if (isLoading || !config) return null

  const enabled = enabledDraft ?? config.enabled
  const url = urlDraft ?? config.url ?? ''
  const trimmedUrl = url.trim()
  const key = `${trimmedUrl}|${token.trim()}`
  const hasToken = token.trim() !== '' || config.token_configured
  const connectionChanged = trimmedUrl !== (config.url ?? '') || token.trim() !== ''
  const dirty = enabled !== config.enabled || connectionChanged
  const tested = testedKey === key && test.data?.ok === true
  // Encender, o cambiar a dónde se envía estando encendido, exige una prueba
  // exitosa de esos mismos datos. Apagar no exige nada.
  const needsTest = enabled && (connectionChanged || !config.enabled)
  const canTest = looksLikeUrl(trimmedUrl) && hasToken && !test.isPending
  const canSave = dirty && !save.isPending && (!needsTest || tested)

  function runTest() {
    setTestedKey(key)
    test.mutate({ url: trimmedUrl, token: token.trim() })
  }

  function saveChanges() {
    save.mutate({ enabled, url: trimmedUrl, token: token.trim() || null }, {
      onSuccess: saved => {
        setEnabledDraft(null); setUrlDraft(null); setToken(''); setTestedKey(null)
        toast.success(saved.enabled ? 'Las citas se enviarán al ERP.' : 'Las citas ya no se envían al ERP.')
      },
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  const testResult = testedKey === key ? test.data : undefined

  return (
    <section aria-labelledby="erp-appointments-title" className="border-t border-wa-border pt-4 dark:border-wa-border-dark">
      <h3 id="erp-appointments-title" className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Citas en la agenda del ERP</h3>
      <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
        Cada cita que se agenda acá aparece en la agenda del ERP con su paciente, su paquete y su adelanto.
        El formulario de cita pasa a pedir el DNI, el paquete y el método de pago del adelanto.
      </p>

      <label className="mt-3 flex items-center gap-2 text-sm text-wa-text dark:text-wa-text-dark">
        <Checkbox checked={enabled} onCheckedChange={setEnabledDraft} disabled={save.isPending} />
        Enviar las citas al ERP
      </label>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="erp-appointments-url" className={labelClass}>Dirección del ERP</label>
          <Input id="erp-appointments-url" type="url" inputMode="url" value={url} onChange={event => setUrlDraft(event.target.value)} placeholder="https://mi-erp.com" />
        </div>
        <div>
          <label htmlFor="erp-appointments-token" className={labelClass}>Token de la integración</label>
          <Input
            id="erp-appointments-token" type="password" autoComplete="off" value={token}
            onChange={event => setToken(event.target.value)}
            placeholder={config.token_configured ? 'Guardado · escribe para cambiarlo' : 'El mismo que se configuró en el ERP'}
            aria-describedby="erp-appointments-token-hint"
          />
          <p id="erp-appointments-token-hint" className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            Es el valor de CRM_INTEGRATION_TOKEN en el ERP. No se vuelve a mostrar.
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button variant="secondary" className="h-11 sm:h-9" onClick={runTest} disabled={!canTest} aria-busy={test.isPending}>
          {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
          {test.isPending ? 'Probando…' : 'Probar conexión'}
        </Button>
        <Button className="h-11 sm:h-9" onClick={saveChanges} disabled={!canSave}>
          {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
          Guardar
        </Button>
        {needsTest && !tested && <span className="text-xs text-wa-muted dark:text-wa-muted-dark">Prueba la conexión antes de guardar.</span>}
      </div>

      <div className="mt-2 min-h-5 text-xs" aria-live="polite">
        {testResult?.ok && (
          <p className="flex items-center gap-1 text-wa-primary-strong dark:text-wa-primary">
            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> El ERP respondió: la dirección y el token son correctos.
          </p>
        )}
        {testResult && !testResult.ok && <p role="alert" className="text-red-600 dark:text-red-400">{testResult.error}</p>}
        {test.isError && testedKey === key && <p role="alert" className="text-red-600 dark:text-red-400">{extractErrorMessage(test.error)}</p>}
      </div>
    </section>
  )
}
