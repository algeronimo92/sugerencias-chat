import { useState } from 'react'
import { KeyRound, Laptop, Loader2, LogOut, ShieldCheck, Trash2, X } from 'lucide-react'
import { useLogoutAll, usePinStatus, useRemovePin, useRevokeSession, useSessions, useSetupPin } from '../hooks/useAuth'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { Input, labelClass } from './ui/Input'

interface Props {
  onClose: () => void
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function AccountSecurityDialog({ onClose }: Props) {
  const { data: pinStatus, isLoading: isLoadingPin } = usePinStatus()
  const { data: sessions, isLoading: isLoadingSessions } = useSessions()
  const setupPin = useSetupPin()
  const removePin = useRemovePin()
  const revokeSession = useRevokeSession()
  const logoutAll = useLogoutAll()
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [password, setPassword] = useState('')
  const [saved, setSaved] = useState(false)

  function submitPin(event: React.FormEvent) {
    event.preventDefault()
    setSaved(false)
    if (pin !== confirmPin || !/^\d{6}$/.test(pin)) return
    setupPin.mutate(
      { pin, currentPassword: password },
      {
        onSuccess: () => {
          setPin('')
          setConfirmPin('')
          setPassword('')
          setSaved(true)
        },
      },
    )
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={`${dialogContentPositionClass} flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
          <div className="flex shrink-0 items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-wa-primary" />
              <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Acceso y seguridad</Dialog.Title>
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-wa-muted hover:text-gray-600 dark:hover:text-gray-300"><X className="h-4 w-4" /></button>
          </div>

          <div className="flex-1 space-y-6 overflow-y-auto p-4">
            <section>
              <div className="mb-2 flex items-center justify-between gap-3">
                <div>
                  <h2 className="flex items-center gap-1.5 text-sm font-semibold text-wa-text dark:text-wa-text-dark"><KeyRound className="h-4 w-4" /> PIN rápido</h2>
                  <p className="mt-0.5 text-xs text-wa-muted">Sólo funciona en este dispositivo.</p>
                </div>
                {pinStatus?.available && <span className="rounded-full bg-green-100 px-2 py-1 text-[10px] font-semibold text-green-700 dark:bg-green-950 dark:text-green-300">Activo</span>}
              </div>

              {isLoadingPin ? <Loader2 className="h-4 w-4 animate-spin text-wa-muted" /> : (
                <form onSubmit={submitPin} className="space-y-3 rounded-lg bg-wa-hover p-3 dark:bg-wa-head-dark/60">
                  {setupPin.error && <p className="text-xs text-red-500">{extractErrorMessage(setupPin.error)}</p>}
                  {removePin.error && <p className="text-xs text-red-500">{extractErrorMessage(removePin.error)}</p>}
                  {saved && <p className="text-xs text-green-600 dark:text-green-400">PIN configurado correctamente.</p>}
                  <div className="grid grid-cols-2 gap-2">
                    <div><label htmlFor="security-pin" className={labelClass}>{pinStatus?.available ? 'Nuevo PIN' : 'PIN'}</label><Input id="security-pin" value={pin} onChange={event => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="6 dígitos" /></div>
                    <div><label htmlFor="security-pin-confirm" className={labelClass}>Repetir PIN</label><Input id="security-pin-confirm" value={confirmPin} onChange={event => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="new-password" maxLength={6} placeholder="6 dígitos" /></div>
                  </div>
                  {confirmPin && pin !== confirmPin && <p className="text-[11px] text-red-500">Los PIN no coinciden.</p>}
                  <div><label htmlFor="security-password" className={labelClass}>Contraseña actual para confirmar</label><Input id="security-password" type="password" value={password} onChange={event => setPassword(event.target.value)} autoComplete="current-password" /></div>
                  <div className="flex items-center justify-between gap-2">
                    {pinStatus?.available ? <button type="button" disabled={removePin.isPending} onClick={() => removePin.mutate()} className="text-xs text-red-600 hover:underline dark:text-red-400">Quitar PIN</button> : <span />}
                    <Button type="submit" disabled={setupPin.isPending || pin.length !== 6 || pin !== confirmPin || !password}>
                      {setupPin.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                      {pinStatus?.available ? 'Cambiar PIN' : 'Crear PIN'}
                    </Button>
                  </div>
                </form>
              )}
            </section>

            <section>
              <h2 className="flex items-center gap-1.5 text-sm font-semibold text-wa-text dark:text-wa-text-dark"><Laptop className="h-4 w-4" /> Sesiones abiertas</h2>
              <p className="mb-2 mt-0.5 text-xs text-wa-muted">Podés cerrar cualquier equipo que no reconozcas.</p>
              <div className="space-y-2">
                {isLoadingSessions && <Loader2 className="h-4 w-4 animate-spin text-wa-muted" />}
                {sessions?.map(session => (
                  <div key={session.id} className="flex items-center gap-3 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark">
                    <Laptop className="h-4 w-4 shrink-0 text-wa-muted" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-xs font-medium text-wa-text dark:text-wa-text-dark">{session.device_name} {session.current && <span className="text-wa-primary">· actual</span>}</p>
                      <p className="text-[10px] text-wa-muted">Último uso: {formatDate(session.last_used_at)} · {session.auth_method === 'pin' ? 'PIN' : 'contraseña'}</p>
                    </div>
                    {!session.current && <button type="button" disabled={revokeSession.isPending} onClick={() => revokeSession.mutate(session.id)} aria-label={`Cerrar sesión en ${session.device_name}`} title="Cerrar esta sesión" className="rounded-md p-2 text-wa-muted hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/30"><Trash2 className="h-3.5 w-3.5" /></button>}
                  </div>
                ))}
              </div>
            </section>

            <section className="rounded-lg border border-red-200 p-3 dark:border-red-900">
              <h2 className="text-sm font-semibold text-red-700 dark:text-red-300">¿Perdiste un equipo?</h2>
              <p className="mb-3 mt-1 text-xs text-wa-muted">Cierra todas las sesiones y elimina los PIN de todos tus dispositivos.</p>
              {logoutAll.error && <p className="mb-2 text-xs text-red-500">{extractErrorMessage(logoutAll.error)}</p>}
              <Button variant="secondary" disabled={logoutAll.isPending} onClick={() => logoutAll.mutate()} className="text-red-600 dark:text-red-400">
                {logoutAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                Cerrar sesión en todos los dispositivos
              </Button>
            </section>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
