import { Loader2, MessagesSquare } from 'lucide-react'
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { useLogin } from '../hooks/useAuth'
import { extractErrorMessage } from '../utils/errors'
import { Button, Input, labelClass } from './ui'

const loginSchema = z.object({
  email: z.string().trim().min(1, 'Ingresa tu email.').email('Ingresa un email válido.'),
  password: z.string().min(1, 'Ingresa tu contraseña.'),
})

type LoginValues = z.infer<typeof loginSchema>

export function LoginPage() {
  const { mutate: login, isPending, error } = useLogin()
  const { register, handleSubmit, formState: { errors } } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { email: '', password: '' },
  })

  return (
    <div className="flex items-center justify-center h-screen bg-wa-app dark:bg-wa-app-dark px-4">
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
            <Input
              id="login-password"
              type="password"
              {...register('password')}
              autoComplete="current-password"
              aria-invalid={!!errors.password}
            />
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
