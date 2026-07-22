import { useEffect, useState } from 'react'
import { CheckCircle2, Loader2, LogOut, QrCode, RefreshCw, Smartphone } from 'lucide-react'
import { useConnectWhatsapp, useLogoutWhatsapp, useWhatsappStatus, type WhatsappQr } from '../hooks/useWhatsapp'
import { extractErrorMessage } from '../utils/errors'

interface Props {
  onGoToClaves: () => void
}

// El QR de WhatsApp rota cada ~20-30s; se refresca en pantalla antes de que expire.
const QR_REFRESH_MS = 20_000

export function WhatsappPanel({ onGoToClaves }: Props) {
  const { data: status, isLoading, error } = useWhatsappStatus({ pollUntilConnected: true })
  const { mutate: connect, isPending: isConnecting } = useConnectWhatsapp()
  const { mutate: logout, isPending: isLoggingOut } = useLogoutWhatsapp()

  const [qr, setQr] = useState<WhatsappQr | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const state = status?.state
  const isConnected = state === 'open'

  // Al quedar vinculada (el polling detecta el escaneo), el QR ya no sirve.
  useEffect(() => {
    if (isConnected) setQr(null)
  }, [isConnected])

  function requestQr() {
    setActionError(null)
    connect(undefined, {
      onSuccess: (data) => {
        if (data.base64) setQr(data)
        else if (data.state === 'open') setQr(null)
        else setActionError('Evolution no devolvió el QR todavía. Esperá unos segundos y probá otra vez.')
      },
      onError: (err) => setActionError(extractErrorMessage(err)),
    })
  }

  // Mientras se muestra el QR y no se conecta, se pide uno nuevo periódicamente
  // para que no expire delante del usuario. Este refresco es SILENCIOSO: si una
  // llamada falla no se muestra error, porque el estado real de la vinculación
  // lo determina el polling de /status — mostrar un error acá durante el
  // emparejamiento confundía con un "no se pudo conectar".
  useEffect(() => {
    if (!qr || isConnected) return
    const timer = setInterval(() => {
      connect(undefined, {
        onSuccess: (data) => { if (data.base64) setQr(data) },
        onError: () => {},
      })
    }, QR_REFRESH_MS)
    return () => clearInterval(timer)
  }, [qr, isConnected, connect])

  function handleLogout() {
    // El logout es lo ÚNICO que "desconecta todo": corta la recepción de
    // mensajes nuevos por n8n hasta volver a vincular. No borra chats guardados,
    // pero se confirma para que no se dispare por error.
    const ok = window.confirm(
      'Desvincular WhatsApp corta la recepción de mensajes nuevos (n8n) hasta que ' +
      'vuelvas a escanear el QR. NO borra ningún chat ya guardado. ¿Desvincular?'
    )
    if (!ok) return
    setActionError(null)
    setQr(null)
    logout(undefined, { onError: (err) => setActionError(extractErrorMessage(err)) })
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-gray-400 dark:text-gray-500">
        <Loader2 className="h-4 w-4 animate-spin" /> Consultando estado…
      </div>
    )
  }

  if (state === 'not_configured') {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
        <p className="mb-3">
          Primero completá <span className="font-semibold">URL, API key e instancia</span> de Evolution API.
        </p>
        <button
          type="button"
          onClick={onGoToClaves}
          className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
        >
          Ir a la pestaña Claves
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
        <Smartphone className="h-4 w-4" />
        Instancia: <span className="font-medium text-gray-700 dark:text-gray-200">{status?.instance ?? '—'}</span>
      </div>

      {isConnected ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-400">
            <CheckCircle2 className="h-5 w-5 shrink-0" />
            WhatsApp vinculado
          </div>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Vinculado como dispositivo (tu teléfono sigue siendo el principal). Desvincular no borra ningún chat.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isLoggingOut}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-gray-700 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            {isLoggingOut ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
            Desvincular
          </button>
        </div>
      ) : qr && qr.base64 ? (
        <div className="space-y-3">
          <div className="flex justify-center rounded-xl border border-gray-200 bg-white p-4 dark:border-gray-700">
            <img src={qr.base64} alt="Código QR de WhatsApp" className="h-56 w-56 max-w-full" />
          </div>
          <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {state === 'connecting' ? 'Vinculando…' : 'Esperando que escanees el QR…'}
          </div>
          {qr.pairing_code && (
            <p className="text-center text-xs text-gray-500 dark:text-gray-400">
              O ingresá el código: <span className="font-mono font-semibold tracking-widest text-gray-700 dark:text-gray-200">{qr.pairing_code}</span>
            </p>
          )}
          <p className="text-center text-[11px] text-gray-400 dark:text-gray-500">
            En tu teléfono: WhatsApp › Dispositivos vinculados › Vincular un dispositivo.
          </p>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={requestQr}
              disabled={isConnecting}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-green-600 disabled:opacity-50 dark:text-gray-400"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isConnecting ? 'animate-spin' : ''}`} /> Refrescar QR
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {state === 'missing'
              ? 'La instancia configurada no existe todavía en Evolution. Revisá el nombre en la pestaña Claves.'
              : 'WhatsApp no está vinculado.'}
          </p>
          <p className="text-[11px] text-gray-400 dark:text-gray-500">
            Escaneá el QR desde tu teléfono para vincularlo como un dispositivo. No borra ningún chat.
          </p>
          <button
            type="button"
            onClick={requestQr}
            disabled={isConnecting}
            className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {isConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
            Vincular por QR
          </button>
        </div>
      )}

      {actionError && <p className="text-xs text-red-500 dark:text-red-400">{actionError}</p>}
      {error && !actionError && !status && (
        <p className="text-xs text-red-500 dark:text-red-400">No se pudo consultar el estado de la conexión.</p>
      )}
    </div>
  )
}
