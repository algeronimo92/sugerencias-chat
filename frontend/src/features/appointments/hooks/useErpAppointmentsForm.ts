import { useState } from 'react'
import { toast } from 'sonner'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { canSaveConnection, connectionRules } from '../domain/erpConnection'
import { useErpAppointmentsConfig, useSaveErpAppointmentsConfig, useTestErpAppointments } from '../queries'

/**
 * Estado y acciones de la sección "Citas en la agenda del ERP". Lo que está en
 * pantalla es lo guardado hasta que el admin lo toca; las reglas de qué se
 * puede probar y guardar viven en ``domain/erpConnection``.
 */
export function useErpAppointmentsForm() {
  const { data: config } = useErpAppointmentsConfig()
  const save = useSaveErpAppointmentsConfig()
  const test = useTestErpAppointments()
  // null: todavía no se tocó, vale lo guardado.
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null)
  const [urlDraft, setUrlDraft] = useState<string | null>(null)
  const [token, setToken] = useState('')
  const [testedKey, setTestedKey] = useState<string | null>(null)

  if (!config) return null

  const saved = { enabled: config.enabled, url: config.url ?? '', tokenConfigured: config.token_configured }
  const draft = { enabled: enabledDraft ?? saved.enabled, url: urlDraft ?? saved.url, token }
  const rules = connectionRules(saved, draft)
  // La prueba solo cuenta si fue de estos mismos datos.
  const current = testedKey === rules.key
  const tested = current && test.data?.ok === true

  function runTest() {
    setTestedKey(rules.key)
    test.mutate({ url: draft.url.trim(), token: token.trim() })
  }

  function saveChanges() {
    save.mutate({ enabled: draft.enabled, url: draft.url.trim(), token: token.trim() || null }, {
      onSuccess: result => {
        setEnabledDraft(null); setUrlDraft(null); setToken(''); setTestedKey(null)
        toast.success(result.enabled ? 'Las citas se enviarán al ERP.' : 'Las citas ya no se envían al ERP.')
      },
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  return {
    draft,
    tokenConfigured: saved.tokenConfigured,
    saving: save.isPending,
    testing: test.isPending,
    canTest: rules.canTest && !test.isPending,
    canSave: canSaveConnection(rules, tested) && !save.isPending,
    mustTest: rules.needsTest && !tested,
    testResult: current ? test.data : undefined,
    testError: current && test.isError ? extractErrorMessage(test.error) : null,
    setEnabled: setEnabledDraft, setUrl: setUrlDraft, setToken, runTest, saveChanges,
  }
}

export type ErpAppointmentsForm = NonNullable<ReturnType<typeof useErpAppointmentsForm>>
