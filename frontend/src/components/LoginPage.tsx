import { Eye, EyeOff, KeyRound, Loader2, MessagesSquare } from 'lucide-react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { PIN_LENGTH, useLogin, usePinLogin, usePinStatus } from '../hooks/useAuth'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { Input, labelClass } from './ui/Input'

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Ingresa tu email.').email('Ingresa un email válido.'),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
  remember_device: z.boolean(),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const { data: pinStatus, isLoading: isLoadingPinStatus } = usePinStatus()
  const { mutate: login, isPending, error } = useLogin()
  const { mutate: pinLogin, isPending: isPinPending, error: pinError } = usePinLogin()
  const [showPassword, setShowPassword] = useState(false)
  const [usePassword, setUsePassword] = useState(false)
  const [pin, setPin] = useState('')
  const { register, handleSubmit, setValue, watch, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '', remember_device: true },
  })

  const showPin = Boolean(pinStatus?.available) && !usePassword

  return (
    <div className="flex h-full items-center justify-center bg-wa-app px-4 dark:bg-wa-app-dark">
      <div className="w-full max-w-sm overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <div className="flex flex-col items-center gap-2 px-6 pb-4 pt-6">
          <div className="flex h-11 w-11 items-center justify-center rounded-full bg-wa-primary shadow-sm">
            {showPin ? <KeyRound className="h-5 w-5 text-white" /> : <MessagesSquare className="h-5 w-5 text-white" />}
          </div>
          <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">DermicaPro</p>
          <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
            {showPin ? `Hola, ${pinStatus?.user_name}` : 'Panel de leads'}
          </p>
        </div>

        {isLoadingPinStatus ? (
          <div className="flex justify-center px-6 pb-8"><Loader2 className="h-5 w-5 animate-spin text-wa-muted" /></div>
        ) : showPin ? (
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (pin.length === PIN_LENGTH) pinLogin(pin)
            }}
            className="space-y-4 px-6 pb-6"
          >
            {pinError && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">{extractErrorMessage(pinError)}</p>}
            <div>
              <label htmlFor="login-pin" className={labelClass}>PIN de este dispositivo</label>
              <Input
                id="login-pin"
                value={pin}
                onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH))}
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                maxLength={PIN_LENGTH}
                className="text-center text-xl tracking-[0.45em]"
                aria-label={`PIN de ${PIN_LENGTH} dígitos`}
              />
              <p className="mt-1 text-center text-[11px] text-wa-muted">{pinStatus?.masked_email}</p>
            </div>
            <Button type="submit" disabled={isPinPending || pin.length !== PIN_LENGTH} className="h-10 w-full">
              {isPinPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Entrar con PIN
            </Button>
            <button type="button" onClick={() => setUsePassword(true)} className="w-full text-xs text-wa-primary-strong hover:underline dark:text-wa-primary">
              Usar correo y contraseña
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmit(values => login(values))} className="px-6 pb-6">
            <div className="space-y-3 pb-4">
              {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">{extractErrorMessage(error)}</p>}
              <div>
                <label htmlFor="login-email" className={labelClass}>Email</label>
                <Input id="login-email" type="email" {...register('email')} autoComplete="username" autoFocus aria-invalid={!!errors.email} />
                {errors.email && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{errors.email.message}</p>}
              </div>
              <div>
                <label htmlFor="login-password" className={labelClass}>Contraseña</label>
                <div className="relative">
                  <Input id="login-password" type={showPassword ? 'text' : 'password'} {...register('password')} autoComplete="current-password" aria-invalid={!!errors.password} className="pr-10" />
                  <button type="button" onClick={() => setShowPassword(value => !value)} aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-wa-muted hover:text-wa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:text-wa-muted-dark dark:hover:text-wa-text-dark">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                {errors.password && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{errors.password.message}</p>}
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-gray-600 dark:text-gray-300">
                <Checkbox checked={watch('remember_device')} onCheckedChange={(checked) => setValue('remember_device', checked === true)} />
                <span><strong className="font-medium">Recordar este dispositivo</strong><br /><span className="text-[11px] text-wa-muted">Sólo en un equipo personal. Mantiene la sesión y permite configurar un PIN.</span></span>
              </label>
            </div>
            <Button type="submit" disabled={isPending} className="h-10 w-full">
              {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Entrar
            </Button>
            {pinStatus?.available && <button type="button" onClick={() => setUsePassword(false)} className="mt-3 w-full text-xs text-wa-primary-strong hover:underline dark:text-wa-primary">Volver al PIN</button>}
          </form>
        )}
      </div>
    </div>
  )
}
