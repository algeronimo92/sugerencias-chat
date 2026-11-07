import { AlertTriangle, Database, Loader2, Lock, PlugZap, Unlink } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { Input, labelClass } from '../../../shared/ui/Input'
import { IntegrationCard, type IntegrationState } from '../../../shared/ui/IntegrationCard'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { ErpSyncCard } from '../../catalogs/public/ErpSyncCard'
import type { ErpTestResult } from '../../catalogs/public/erpTypes'
import { useErpSyncStatus, useInvalidateErpSync, useRunErpSync, useTestErpConnection } from '../../catalogs/public/useErpSync'
import { useSaveSettings, useSettings } from '../hooks/useSettings'

const URL_KEY = 'erp_catalog_url'

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

function looksLikeUrl(value: string): boolean {
  return /^https?:\/\/[^\s/]+/i.test(value.trim())
}

/** Lo que devolvió la prueba, para que el admin reconozca sus servicios antes de conectar. */
function TestResult({ result, alreadyConnected }: { result: ErpTestResult; alreadyConnected: boolean }) {
  if (!result.ok) {
    return (
      <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm dark:border-red-900 dark:bg-red-950/30">
        <p className="font-semibold text-red-800 dark:text-red-200">No se pudo leer el catálogo</p>
        <p className="mt-0.5 text-red-700 dark:text-red-300">{result.error}</p>
        <p className="mt-1 text-xs text-red-700/80 dark:text-red-300/80">Revisa que la URL abra en el navegador y devuelva JSON.</p>
      </div>
    )
  }
  const missing = result.services_without_packages
  return (
    <div role="status" className="rounded-lg border border-wa-primary/30 bg-wa-primary/5 p-3 text-sm dark:bg-wa-primary/10">
      <p className="font-semibold text-wa-text dark:text-wa-text-dark">Conexión correcta · {hostOf(result.url ?? '')}</p>
      <p className="text-wa-muted dark:text-wa-muted-dark">
        {result.services_total} {result.services_total === 1 ? 'servicio' : 'servicios'} · {result.packages_total} {result.packages_total === 1 ? 'paquete' : 'paquetes'}
      </p>
      {result.sample.length > 0 && (
        <>
          <p className="mt-2 text-xs font-medium text-wa-muted dark:text-wa-muted-dark">Muestra de {result.sample.length} servicios</p>
          <ul className="mt-1 space-y-1">
            {result.sample.map(service => (
              <li key={service.name} className="text-sm">
                <span className="font-medium text-wa-text dark:text-wa-text-dark">{service.name}</span>
                {service.packages.length > 0 && (
                  <span className="block text-xs tabular-nums text-wa-muted dark:text-wa-muted-dark">
                    {service.packages.map(pkg => `${pkg.label} · ${pkg.sessions} ${pkg.sessions === 1 ? 'sesión' : 'sesiones'} · ${pkg.price}`).join('  |  ')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
      {missing.length > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>
            {missing.length} {missing.length === 1 ? 'servicio sin paquetes' : 'servicios sin paquetes'}: {missing.slice(0, 3).join(', ')}
            {missing.length > 3 ? ` (+${missing.length - 3} más)` : ''} · Se traerán sin precio; el asistente IA no podrá cotizarlos.
          </span>
        </p>
      )}
      {!alreadyConnected && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          Al guardar, los servicios y paquetes del ERP pasan a solo lectura en Catálogos; allí seguirás editando descripción y notas para la IA.
        </p>
      )}
    </div>
  )
}

/**
 * El ERP manda sobre la lista de precios. "Guardar" solo se habilita tras
 * una prueba exitosa de esa misma URL: así no se conecta una fuente rota que
 * fallaría en silencio cada hora. Al guardar se dispara la primera
 * sincronización para que el admin vea de inmediato que funciona.
 */
export function ErpIntegrationCard() {
  const navigate = useNavigate()
  const { data: settings = [] } = useSettings(true)
  const savedUrl = useMemo(() => settings.find(item => item.key === URL_KEY)?.value ?? '', [settings])
  const { data: syncStatus } = useErpSyncStatus()
  const save = useSaveSettings()
  const runSync = useRunErpSync()
  const test = useTestErpConnection()
  const invalidateErp = useInvalidateErpSync()
  const [url, setUrl] = useState('')
  const [touched, setTouched] = useState(false)
  const [tested, setTested] = useState<{ url: string; result: ErpTestResult } | null>(null)
  const [disconnecting, setDisconnecting] = useState(false)
  const resultRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!touched) setUrl(savedUrl)
  }, [savedUrl, touched])

  const trimmed = url.trim()
  const configured = Boolean(savedUrl)
  const validUrl = looksLikeUrl(trimmed)
  const testedThis = tested?.url === trimmed ? tested.result : null
  const canSave = Boolean(testedThis?.ok) && trimmed !== savedUrl
  const busy = test.isPending || save.isPending || runSync.isPending

  const state: IntegrationState = runSync.isPending
    ? 'syncing'
    : !configured
      ? 'unconfigured'
      : syncStatus?.last_error
        ? 'error'
        : 'connected'

  function handleTest() {
    test.mutate(trimmed, {
      onSuccess: result => {
        setTested({ url: trimmed, result })
        window.setTimeout(() => resultRef.current?.focus(), 0)
      },
      onError: err => {
        setTested({ url: trimmed, result: { ok: false, url: trimmed, error: extractErrorMessage(err), services_total: 0, packages_total: 0, services_without_packages: [], sample: [] } })
      },
    })
  }

  function handleSave() {
    save.mutate({ [URL_KEY]: trimmed }, {
      onSuccess: () => {
        setTouched(false)
        invalidateErp()
        toast.success('ERP conectado. Los servicios del ERP son ahora de solo lectura en Catálogos.', {
          action: { label: 'Ver catálogos', onClick: () => navigate('/catalogs') },
        })
        runSync.mutate(undefined, { onError: err => toast.error(extractErrorMessage(err)) })
      },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  function handleDisconnect() {
    setDisconnecting(false)
    save.mutate({ [URL_KEY]: '' }, {
      onSuccess: () => {
        setTouched(false)
        setUrl('')
        setTested(null)
        invalidateErp()
        toast.success('ERP desconectado. Los servicios vuelven a editarse en Catálogos.')
      },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  return (
    <IntegrationCard
      id="erp"
      icon={Database}
      title="ERP del negocio"
      description="La lista de precios se trae del ERP cada hora: servicios y paquetes con los que cotiza el asistente IA."
      state={state}
      stateLabel={state === 'connected' ? `Conectado · ${hostOf(savedUrl)}` : undefined}
      actions={configured ? (
        <Button variant="ghost" size="sm" className="h-11 text-red-600 hover:text-red-700 dark:text-red-400 sm:h-9" onClick={() => setDisconnecting(true)} disabled={busy}>
          <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
          Desconectar
        </Button>
      ) : undefined}
    >
      <div className="space-y-3">
        <div>
          <label htmlFor="erp-url" className={labelClass}>URL pública del catálogo</label>
          <Input
            id="erp-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={event => { setTouched(true); setUrl(event.target.value) }}
            placeholder="https://mi-erp.com/api/public/catalog"
            aria-describedby="erp-url-hint"
            aria-invalid={touched && trimmed !== '' && !validUrl ? true : undefined}
          />
          <p id="erp-url-hint" className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
            Debe abrir sin iniciar sesión y devolver JSON.
            {!canSave && trimmed && trimmed !== savedUrl ? ' Prueba la URL antes de guardar.' : ''}
          </p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="secondary" className="h-11 sm:h-9" onClick={handleTest} disabled={!validUrl || busy} aria-busy={test.isPending}>
            {test.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
            {test.isPending ? 'Probando…' : 'Probar conexión'}
          </Button>
          <Button className="h-11 sm:h-9" onClick={handleSave} disabled={!canSave || busy}>
            {save.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {configured ? 'Guardar nueva URL' : 'Guardar y conectar'}
          </Button>
        </div>
        <div ref={resultRef} tabIndex={-1} className="min-h-6 outline-none">
          {test.isPending ? (
            <div className="space-y-2" aria-hidden="true">
              <Skeleton className="h-4 w-56" />
              <Skeleton className="h-3 w-40" />
              <Skeleton className="h-3 w-72" />
            </div>
          ) : testedThis ? (
            <TestResult result={testedThis} alreadyConnected={configured} />
          ) : null}
        </div>
        {configured && <ErpSyncCard />}
      </div>
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="¿Desconectar el ERP?"
        description="El catálogo deja de sincronizarse. Los servicios que trajo el ERP siguen en el CRM y vuelven a poder editarse a mano."
        confirmLabel="Desconectar"
        onConfirm={handleDisconnect}
      />
    </IntegrationCard>
  )
}
