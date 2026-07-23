import { useState } from 'react'
import { Loader2, MessagesSquare } from 'lucide-react'
import { useLogin } from '../hooks/useAuth'
import { extractErrorMessage } from '../utils/errors'
import { Input, labelClass } from './ui'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { mutate: login, isPending, error } = useLogin()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    login({ email: email.trim(), password })
  }

  return (
    <div className="flex items-center justify-center h-screen bg-wa-app dark:bg-wa-app-dark px-4">
      <form
        onSubmit={handleSubmit}
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
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          <div>
            <label htmlFor="login-password" className={labelClass}>Contraseña</label>
            <Input
              id="login-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
            />
          </div>
        </div>

        <div className="px-6 pb-6">
          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 text-sm font-semibold text-white bg-wa-primary hover:bg-wa-primary-strong active:bg-wa-primary-deep disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-sm"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Entrar
          </button>
        </div>
      </form>
    </div>
  )
}
