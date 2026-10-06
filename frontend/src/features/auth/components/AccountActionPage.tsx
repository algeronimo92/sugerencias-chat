import { CheckCircle2, Eye, EyeOff, KeyRound, Loader2, Moon, Sun } from 'lucide-react'
import { useState } from 'react'
import { useBrand } from '../../../shared/branding'
import { useTheme } from '../../../shared/hooks/useTheme'
import { BrandLogo } from '../../../shared/ui/BrandLogo'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useActionToken, useCompleteAccountAction } from '../queries'

export function AccountActionPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? ''
  const brand = useBrand()
  const { theme, toggleTheme } = useTheme()
  const action = useActionToken(token)
  const complete = useCompleteAccountAction(action.data?.purpose)
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const mismatch = confirmation.length > 0 && password !== confirmation
  const canSubmit = password.length >= 10 && password === confirmation

  return (
    <main className="relative flex min-h-full items-center justify-center overflow-y-auto bg-[#f3f7f6] px-4 py-10 dark:bg-[#07110f]">
      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'}
        className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-xl border border-wa-border bg-white text-wa-muted dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-muted-dark"
      >
        {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>

      <section className="w-full max-w-md rounded-[24px] border border-white/80 bg-white p-7 shadow-[0_24px_80px_-28px_rgba(15,43,36,0.28)] sm:p-9 dark:border-white/10 dark:bg-wa-panel-dark">
        <div className="flex items-center gap-3">
          <BrandLogo sizeClass="h-10 w-10" iconClass="h-5 w-5" />
          <span className="font-bold text-wa-text dark:text-white">{brand.name}</span>
        </div>

        {action.isLoading ? (
          <div className="flex min-h-64 items-center justify-center" role="status">
            <Loader2 className="h-6 w-6 animate-spin text-wa-primary" />
          </div>
        ) : action.error || !action.data ? (
          <div className="py-12 text-center">
            <KeyRound className="mx-auto h-9 w-9 text-wa-muted" />
            <h1 className="mt-5 text-xl font-bold text-wa-text dark:text-white">El enlace ya no está disponible</h1>
            <p className="mt-2 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
              Puede haber vencido o haberse usado. Solicita uno nuevo para continuar.
            </p>
            <Button className="mt-6" onClick={() => { window.location.href = '/' }}>Volver al acceso</Button>
          </div>
        ) : complete.isSuccess ? (
          <div className="py-12 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-wa-primary" />
            <h1 className="mt-5 text-xl font-bold text-wa-text dark:text-white">Contraseña guardada</h1>
            <p className="mt-2 text-sm text-wa-muted dark:text-wa-muted-dark">Ya puedes ingresar a tu cuenta.</p>
            <Button className="mt-6" onClick={() => { window.location.href = '/' }}>Ir al acceso</Button>
          </div>
        ) : (
          <form
            className="mt-8 space-y-5"
            onSubmit={(event) => {
              event.preventDefault()
              if (canSubmit) complete.mutate({ token, password })
            }}
          >
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-wa-primary-strong dark:text-wa-primary">
                {action.data.purpose === 'invitation' ? 'Invitación al equipo' : 'Recuperación de acceso'}
              </p>
              <h1 className="mt-2 text-2xl font-bold text-wa-text dark:text-white">
                {action.data.purpose === 'invitation' ? `Hola, ${action.data.name}` : 'Crea una nueva contraseña'}
              </h1>
              <p className="mt-2 text-sm text-wa-muted dark:text-wa-muted-dark">Cuenta: {action.data.email}</p>
            </div>

            {complete.error && (
              <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/35 dark:text-red-300">
                {extractErrorMessage(complete.error)}
              </p>
            )}

            <label className="block text-sm font-semibold text-wa-text dark:text-wa-text-dark">
              Nueva contraseña
              <span className="relative mt-2 block">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  minLength={10}
                  maxLength={128}
                  autoComplete="new-password"
                  className="h-12 pr-11"
                  required
                />
                <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute right-3 top-1/2 -translate-y-1/2 text-wa-muted">
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </span>
              <span className="mt-1.5 block text-xs font-normal text-wa-muted">Mínimo 10 caracteres.</span>
            </label>

            <label className="block text-sm font-semibold text-wa-text dark:text-wa-text-dark">
              Repite la contraseña
              <Input
                type={showPassword ? 'text' : 'password'}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                autoComplete="new-password"
                className="mt-2 h-12"
                required
              />
              {mismatch && <span className="mt-1.5 block text-xs font-normal text-red-600">Las contraseñas no coinciden.</span>}
            </label>

            <Button type="submit" disabled={!canSubmit || complete.isPending} className="h-12 w-full">
              {complete.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Guardar contraseña
            </Button>
          </form>
        )}
      </section>
    </main>
  )
}
