import { AlertTriangle, Database, Loader2, Lock, PlugZap, Unlink } from 'lucide-react'
import { useMemo, useRef, useState } from 'react'
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

function failedTest(url: string, error: string): ErpTestResult {
  return { ok: false, url, error, services_total: 0, packages_total: 0, services_without_packages: [], sample: [] }
}

function erpState(syncing: boolean, configured: boolean, lastError: string | null | undefined): IntegrationState {
  if (syncing) return 'syncing'
  if (!configured) return 'unconfigured'
  return lastError ? 'error' : 'connected'
}

/**
 * Estado y acciones de la conexión. La URL del input es la guardada hasta que
 * el admin escribe: se deriva en el render en vez de copiarla con un efecto,
 * que costaba un render extra y podía pisar lo que estaba tipeando.
 */
function useErpConnection() {
  const navigate = useNavigate()
  const { data: settings = [] } = useSettings(true)
  const savedUrl = useMemo(() => settings.find(item => item.key === URL_KEY)?.value ?? '', [settings])
  const { data: syncStatus } = useErpSyncStatus()
  const save = useSaveSettings()
  const runSync = useRunErpSync()
  const test = useTestErpConnection()
  const invalidateErp = useInvalidateErpSync()
  const [editedUrl, setEditedUrl] = useState<string | null>(null)
  const [tested, setTested] = useState<{ url: string; result: ErpTestResult } | null>(null)
  const resultRef = useRef<HTMLDivElement>(null)

  const url = editedUrl ?? savedUrl
  const trimmed = url.trim()
  const configured = Boolean(savedUrl)
  const testedThis = tested?.url === trimmed ? tested.result : null

  function testUrl() {
    test.mutate(trimmed, {
      onSuccess: result => {
        setTested({ url: trimmed, result })
        window.setTimeout(() => resultRef.current?.focus(), 0)
      },
      onError: err => setTested({ url: trimmed, result: failedTest(trimmed, extractErrorMessage(err)) }),
    })
  }

  function saveUrl() {
    save.mutate({ [URL_KEY]: trimmed }, {
      onSuccess: () => {
        setEditedUrl(null)
        invalidateErp()
        toast.success('ERP conectado. Los servicios del ERP son ahora de solo lectura en Catálogos.', {
          action: { label: 'Ver catálogos', onClick: () => navigate('/catalogs') },
        })
        runSync.mutate(undefined, { onError: err => toast.error(extractErrorMessage(err)) })
      },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  function disconnect() {
    save.mutate({ [URL_KEY]: '' }, {
      onSuccess: () => {
        setEditedUrl(null)
        setTested(null)
        invalidateErp()
        toast.success('ERP desconectado. Los servicios vuelven a editarse en Catálogos.')
      },
      onError: err => toast.error(extractErrorMessage(err)),
    })
  }

  return {
    url, trimmed, savedUrl, configured, testedThis, resultRef,
    touched: editedUrl !== null,
    validUrl: looksLikeUrl(trimmed),
    canSave: Boolean(testedThis?.ok) && trimmed !== savedUrl,
    busy: test.isPending || save.isPending || runSync.isPending,
    testing: test.isPending,
    saving: save.isPending,
    state: erpState(runSync.isPending, configured, syncStatus?.last_error),
    setUrl: setEditedUrl, testUrl, saveUrl, disconnect,
  }
}

type ErpConnection = ReturnType<typeof useErpConnection>

function ErpUrlField({ erp }: { erp: ErpConnection }) {
  const pendingTest = !erp.canSave && erp.trimmed && erp.trimmed !== erp.savedUrl
  return (
    <div>
      <label htmlFor="erp-url" className={labelClass}>URL pública del catálogo</label>
      <Input
        id="erp-url"
        type="url"
        inputMode="url"
        value={erp.url}
        onChange={event => erp.setUrl(event.target.value)}
        placeholder="https://mi-erp.com/api/public/catalog"
        aria-describedby="erp-url-hint"
        aria-invalid={erp.touched && erp.trimmed !== '' && !erp.validUrl ? true : undefined}
      />
      <p id="erp-url-hint" className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
        Debe abrir sin iniciar sesión y devolver JSON.
        {pendingTest ? ' Prueba la URL antes de guardar.' : ''}
      </p>
    </div>
  )
}

function ErpTestArea({ erp }: { erp: ErpConnection }) {
  return (
    <div ref={erp.resultRef} tabIndex={-1} className="min-h-6 outline-none">
      {erp.testing && (
        <div className="space-y-2" aria-hidden="true">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-3 w-40" />
          <Skeleton className="h-3 w-72" />
        </div>
      )}
      {!erp.testing && erp.testedThis && <TestResult result={erp.testedThis} alreadyConnected={erp.configured} />}
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
  const erp = useErpConnection()
  const [disconnecting, setDisconnecting] = useState(false)

  return (
    <IntegrationCard
      id="erp"
      icon={Database}
      title="ERP del negocio"
      state={erp.state}
      stateLabel={erp.state === 'connected' ? `Conectado · ${hostOf(erp.savedUrl)}` : undefined}
      actions={erp.configured ? (
        <Button variant="ghost" size="sm" className="h-11 text-red-600 hover:text-red-700 dark:text-red-400 sm:h-9" onClick={() => setDisconnecting(true)} disabled={erp.busy}>
          <Unlink className="h-3.5 w-3.5" aria-hidden="true" />
          Desconectar
        </Button>
      ) : undefined}
    >
      <div className="space-y-3">
        <ErpUrlField erp={erp} />
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button variant="secondary" className="h-11 sm:h-9" onClick={erp.testUrl} disabled={!erp.validUrl || erp.busy} aria-busy={erp.testing}>
            {erp.testing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <PlugZap className="h-4 w-4" aria-hidden="true" />}
            {erp.testing ? 'Probando…' : 'Probar conexión'}
          </Button>
          <Button className="h-11 sm:h-9" onClick={erp.saveUrl} disabled={!erp.canSave || erp.busy}>
            {erp.saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : null}
            {erp.configured ? 'Guardar nueva URL' : 'Guardar y conectar'}
          </Button>
        </div>
        <ErpTestArea erp={erp} />
        {erp.configured && <ErpSyncCard />}
      </div>
      <ConfirmDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        title="¿Desconectar el ERP?"
        description="El catálogo deja de sincronizarse. Los servicios que trajo el ERP siguen en el CRM y vuelven a poder editarse a mano."
        confirmLabel="Desconectar"
        onConfirm={() => { setDisconnecting(false); erp.disconnect() }}
      />
    </IntegrationCard>
  )
}
