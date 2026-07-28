import { Eye, EyeOff, Loader2, MessagesSquare } from 'lucide-react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useLogin } from '../hooks/useAuth'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { Input, labelClass } from './ui/Input'
const loginSchema = z.object({
  email: z.string().trim().min(1, 'Ingresa tu email.').email('Ingresa un email válido.'),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const { mutate: login, isPending, error } = useLogin()
  const [showPassword, setShowPassword] = useState(false)
  const { register, handleSubmit, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  return (
    <div className="flex items-center justify-center h-full bg-wa-app dark:bg-wa-app-dark px-4">
      <form
        onSubmit={handleSubmit(values => login(values))}
        className="w-full max-w-sm bg-white dark:bg-wa-panel-dark rounded-xl shadow-xl border border-wa-border dark:border-wa-border-dark overflow-hidden"
      >
        <div className="flex flex-col items-center gap-2 px-6 pt-6 pb-4">
          <div className="w-11 h-11 rounded-full bg-wa-primary flex items-center justify-center shadow-sm">
            <MessagesSquare className="w-5 h-5 text-white" />
          </div>
          <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">DermicaPro</p>
          <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Panel de leads</p>
        </div>

        <div className="px-6 pb-4 space-y-3">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {extractErrorMessage(error)}
            </p>
          )}

          <div>
            <label htmlFor="login-email" className={labelClass}>Email</label>
            <Input
              id="login-email"
              type="email"
              {...register('email')}
              autoComplete="username"
              autoFocus
              aria-invalid={!!errors.email}
            />
            {errors.email && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{errors.email.message}</p>}
          </div>

          <div>
            <label htmlFor="login-password" className={labelClass}>Contraseña</label>
            <div className="relative">
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                {...register('password')}
                autoComplete="current-password"
                aria-invalid={!!errors.password}
                className="pr-10"
              />
              {/* type="button": dentro de un <form> el default es submit, y el
                  ojo enviaría el login en vez de mostrar la contraseña. */}
              <button
                type="button"
                onClick={() => setShowPassword(visible => !visible)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                aria-pressed={showPassword}
                className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-lg text-wa-muted dark:text-wa-muted-dark hover:text-wa-text dark:hover:text-wa-text-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 transition-colors"
              >
                {showPassword
                  ? <EyeOff className="w-4 h-4" aria-hidden="true" />
                  : <Eye className="w-4 h-4" aria-hidden="true" />}
              </button>
            </div>
            {errors.password && <p className="mt-1 text-[11px] text-red-600 dark:text-red-400">{errors.password.message}</p>}
          </div>
        </div>

        <div className="px-6 pb-6">
          <Button
            type="submit"
            disabled={isPending}
            className="h-10 w-full"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Entrar
          </Button>
        </div>
      </form>
    </div>
  )
}
