import { Check, Loader2, PlugZap, Sparkles, Trash2 } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { GeminiMark, OpenAIMark } from '../../../shared/ui/BrandMarks'
import { Input, Select, labelClass } from '../../../shared/ui/Input'
import { IntegrationCard, type IntegrationState } from '../../../shared/ui/IntegrationCard'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useSaveSettings } from '../../platform/public/useSettings'
import { useAiProviders, useRefreshAiProviders, useTestAiProvider } from '../hooks/useAiProviders'
import type { AiProvidersStatus, AiProviderTestResult } from '../types'

const MARKS: Record<string, ComponentType<{ className?: string }>> = { gemini: GeminiMark, openai: OpenAIMark }
const KEY_SETTING: Record<string, string> = { gemini: 'ai_gemini_api_key', openai: 'ai_openai_api_key' }

type Provider = AiProvidersStatus['providers'][number]

/**
 * Una fila por proveedor. "Probar y guardar" prueba la clave tipeada contra el
 * modelo principal de ese proveedor y solo la guarda si responde: así nunca
 * queda guardada una clave que haría fallar las sugerencias.
 */
function ProviderKeyRow({ provider, testModel, onSaved }: { provider: Provider; testModel: string | null; onSaved: () => void }) {
  const Mark = MARKS[provider.provider] ?? Sparkles
  const [apiKey, setApiKey] = useState('')
  const [result, setResult] = useState<AiProviderTestResult | null>(null)
  const test = useTestAiProvider()
  const save = useSaveSettings()
  const typed = apiKey.trim()
  const busy = test.isPending || save.isPending
  const inputId = `ai-key-${provider.provider}`

  function handleTest() {
    setResult(null)
    test.mutate({ provider: provider.provider, apiKey: typed || null, model: testModel }, {
      onSuccess: outcome => {
        setResult(outcome)
        if (!outcome.ok || !typed) return
        save.mutate({ [KEY_SETTING[provider.provider]]: typed }, {
          onSuccess: () => { setApiKey(''); onSaved(); toast.success(`Clave de ${provider.label} guardada`) },
          onError: err => toast.error(extractErrorMessage(err)),
        })
      },
      onError: err => setResult({ ok: false, provider: provider.provider, error: extractErrorMessage(err) }),
    })
  }

  function handleRemove() {
    save.mutate({ [KEY_SETTING[provider.provider]]: '' }, {
      onSuccess: () => { setResult(null); onSaved(); toast.success(`Clave de ${provider.label} quitada`) },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <div className="rounded-lg border border-wa-border/70 p-3 dark:border-wa-border-dark/70">
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={inputId} className="flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark">
          <Mark className="h-5 w-5 text-wa-text dark:text-wa-text-dark" />
          {provider.label}
        </label>
        <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${provider.key_configured ? 'bg-wa-primary/15 text-wa-primary-strong dark:text-wa-primary' : 'bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark'}`}>
          {provider.key_configured ? 'Clave guardada' : 'Sin clave'}
        </span>
      </div>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id={inputId}
          type="password"
          autoComplete="off"
          value={apiKey}
          onChange={event => { setApiKey(event.target.value); setResult(null) }}
          placeholder={provider.key_configured ? '•••• guardada (escribe otra para reemplazarla)' : 'Pega aquí la API key'}
          className="min-w-0 flex-1"
        />
        <div className="flex gap-2">
          <Button variant="secondary" className="h-11 flex-1 sm:h-9 sm:flex-none" onClick={handleTest} disabled={busy || (!typed && !provider.key_configured)} aria-busy={test.isPending}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
            {typed ? 'Probar y guardar' : 'Probar'}
          </Button>
          {provider.key_configured && (
            <Button variant="ghost" size="icon" className="h-11 w-11 text-red-600 sm:h-9 sm:w-9 dark:text-red-400" onClick={handleRemove} disabled={busy} aria-label={`Quitar clave de ${provider.label}`}>
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      </div>
      {result && (
        result.ok ? (
          <p role="status" className="mt-2 flex items-center gap-1.5 text-xs text-wa-primary-strong dark:text-wa-primary">
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            {result.model} responde{result.latency_ms != null ? ` · ${result.latency_ms} ms` : ''}{typed ? '' : ' con la clave guardada'}
          </p>
        ) : (
          <p role="alert" className="mt-2 text-xs text-red-700 dark:text-red-300">{result.error}. La clave no se guardó.</p>
        )
      )}
    </div>
  )
}

function modelLabel(spec: string, providers: Provider[]): string {
  const [provider, model] = spec.split(':', 2)
  const meta = providers.find(item => item.provider === provider)
  return `${meta?.label ?? provider} · ${model}${meta && !meta.key_configured ? ' (sin clave)' : ''}`
}

/**
 * Configuración de IA de las sugerencias de respuesta (el copiloto del chat),
 * no de toda la IA del CRM: el análisis del lead y la voz tienen la suya.
 * Las sugerencias se generan en el CRM con las claves del negocio: sin una
 * clave que funcione, el chat no las ofrece. Las claves son por proveedor y
 * del negocio: si otra función de IA llega a usarlas, se comparten.
 */
export function AiIntegrationCard() {
  const { data: status, isLoading, isError } = useAiProviders()
  const refresh = useRefreshAiProviders()
  const save = useSaveSettings()

  if (isLoading || !status) {
    return (
      <IntegrationCard id="ia-sugerencias" icon={Sparkles} title="Sugerencias con IA" description="Cargando…" state={isError ? 'error' : 'unconfigured'} />
    )
  }

  const allSpecs = status.providers.flatMap(provider => provider.models.map(model => `${provider.provider}:${model}`))
  const state: IntegrationState = status.ready ? 'connected' : 'unconfigured'
  const stateLabel = status.ready ? 'Conectado · tus claves' : undefined

  function saveValues(values: Record<string, string>, message: string) {
    save.mutate(values, {
      onSuccess: () => { refresh(); toast.success(message) },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  function testModelFor(provider: string): string | null {
    for (const spec of [status!.primary_model, status!.fallback_model]) {
      if (spec.startsWith(`${provider}:`)) return spec.split(':', 2)[1]
    }
    return null
  }

  return (
    <IntegrationCard
      id="ia-sugerencias"
      icon={Sparkles}
      title="Sugerencias con IA"
      description="Con qué claves y modelos el copiloto propone respuestas en el chat. Si el modelo principal falla, responde el secundario. Otras funciones de IA se configuran aparte."
      state={state}
      stateLabel={stateLabel}
    >
      <div className="space-y-4">
        <div className="grid gap-3 lg:grid-cols-2">
          {status.providers.map(provider => (
            <ProviderKeyRow key={provider.provider} provider={provider} testModel={testModelFor(provider.provider)} onSaved={refresh} />
          ))}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="ai-primary-model" className={labelClass}>Modelo principal</label>
            <Select id="ai-primary-model" aria-label="Modelo principal" value={status.primary_model} disabled={save.isPending}
              onValueChange={value => saveValues({ ai_suggestions_primary_model: value }, 'Modelo principal actualizado')}>
              {allSpecs.map(spec => <option key={spec} value={spec}>{modelLabel(spec, status.providers)}</option>)}
            </Select>
          </div>
          <div>
            <label htmlFor="ai-fallback-model" className={labelClass}>Modelo secundario (si el principal falla)</label>
            <Select id="ai-fallback-model" aria-label="Modelo secundario" value={status.fallback_model} disabled={save.isPending}
              onValueChange={value => saveValues({ ai_suggestions_fallback_model: value }, 'Modelo secundario actualizado')}>
              {allSpecs.map(spec => <option key={spec} value={spec}>{modelLabel(spec, status.providers)}</option>)}
            </Select>
          </div>
        </div>

        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
          {status.ready
            ? 'Cada sugerencia la responde tu modelo principal y, si falla, el secundario. Lo consume tu cuenta del proveedor.'
            : 'Guarda al menos una clave que pase la prueba: mientras tanto el chat no ofrece sugerencias.'}
          {' '}El análisis automático del lead sigue en el servicio de la plataforma.
        </p>
      </div>
    </IntegrationCard>
  )
}
