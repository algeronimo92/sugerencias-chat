import { ArrowLeftRight } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { Select, labelClass } from '../../../shared/ui/Input'
import type { AiProvidersStatus } from '../types'

type Provider = AiProvidersStatus['providers'][number]

function providerOf(spec: string, providers: Provider[]): Provider | undefined {
  return providers.find(item => item.provider === spec.split(':', 1)[0])
}

function plainLabel(spec: string, providers: Provider[]): string {
  const [, model] = spec.split(':', 2)
  return `${providerOf(spec, providers)?.label ?? spec.split(':', 1)[0]} · ${model}`
}

function optionLabel(spec: string, providers: Provider[]): string {
  const meta = providerOf(spec, providers)
  return `${plainLabel(spec, providers)}${meta && !meta.key_configured ? ' (sin clave)' : ''}`
}

/**
 * Quién procesa de verdad. Un modelo sin clave se salta en silencio: si el
 * primero no tiene clave responde el segundo, y sin decirlo parecía que el
 * principal "no se podía cambiar".
 */
function processingNote(status: AiProvidersStatus): string {
  const { providers, primary_model: primary, fallback_model: fallback } = status
  const primaryReady = Boolean(providerOf(primary, providers)?.key_configured)
  const fallbackReady = Boolean(providerOf(fallback, providers)?.key_configured) && fallback !== primary
  if (primaryReady && fallbackReady) {
    return `Procesa ${plainLabel(primary, providers)}; si falla, responde ${plainLabel(fallback, providers)}.`
  }
  if (primaryReady) return `Procesa ${plainLabel(primary, providers)}, sin respaldo (el segundo no tiene clave o es el mismo modelo).`
  if (fallbackReady) {
    return `${providerOf(primary, providers)?.label ?? 'El primero'} no tiene clave: hoy procesa ${plainLabel(fallback, providers)}.`
  }
  return 'Ningún modelo elegido tiene clave: carga una arriba.'
}

/**
 * Qué modelo procesa las sugerencias y cuál responde si falla. "Invertir
 * orden" cambia los dos de lugar en un solo guardado, cada uno con sus ajustes.
 */
export function ModelOrder({ status, disabled, onSave }: {
  status: AiProvidersStatus
  disabled: boolean
  onSave: (values: Record<string, string>, message: string) => void
}) {
  const specs = status.providers.flatMap(provider => provider.models.map(model => `${provider.provider}:${model}`))
  const { primary_model: primary, fallback_model: fallback } = status

  function swap() {
    onSave({
      ai_suggestions_primary_model: fallback,
      ai_suggestions_fallback_model: primary,
      ai_suggestions_primary_params: JSON.stringify(status.fallback_params ?? {}),
      ai_suggestions_fallback_params: JSON.stringify(status.primary_params ?? {}),
    }, `Orden invertido: ahora procesa ${plainLabel(fallback, status.providers)}`)
  }

  // Elegir en un lado el modelo que está en el otro es pedir el cambio de
  // orden: antes quedaba el mismo modelo en las dos posiciones y el otro
  // proveedor desaparecía de la cadena sin aviso.
  function choosePrimary(value: string) {
    if (value === primary) return
    if (value === fallback) return swap()
    onSave({ ai_suggestions_primary_model: value }, `Ahora procesa ${plainLabel(value, status.providers)}`)
  }

  function chooseFallback(value: string) {
    if (value === fallback) return
    if (value === primary) return swap()
    onSave({ ai_suggestions_fallback_model: value }, `Respaldo: ${plainLabel(value, status.providers)}`)
  }

  return (
    <section aria-label="Orden de los modelos" className="space-y-2">
      <h4 className="text-sm font-medium text-wa-text dark:text-wa-text-dark">Qué modelo procesa las sugerencias</h4>
      <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
        <div>
          <label htmlFor="ai-primary-model" className={labelClass}>1 · Procesa</label>
          <Select id="ai-primary-model" aria-label="Modelo principal" value={primary} disabled={disabled}
            onValueChange={choosePrimary}>
            {specs.map(spec => <option key={spec} value={spec}>{optionLabel(spec, status.providers)}</option>)}
          </Select>
        </div>
        <Button variant="secondary" className="h-11 sm:h-10" onClick={swap} disabled={disabled || primary === fallback} title="Cambiar de lugar el modelo que procesa y el de respaldo">
          <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
          Invertir orden
        </Button>
        <div>
          <label htmlFor="ai-fallback-model" className={labelClass}>2 · Respaldo (si el primero falla)</label>
          <Select id="ai-fallback-model" aria-label="Modelo secundario" value={fallback} disabled={disabled}
            onValueChange={chooseFallback}>
            {specs.map(spec => <option key={spec} value={spec}>{optionLabel(spec, status.providers)}</option>)}
          </Select>
        </div>
      </div>
      <p className="text-xs text-wa-muted dark:text-wa-muted-dark">{processingNote(status)}</p>
    </section>
  )
}
