import { useState } from 'react'
import { Loader2, MessagesSquare } from 'lucide-react'
import { useLogin } from '../hooks/useAuth'
import { extractErrorMessage } from '../utils/errors'

const FIELD_CLASS =
  'w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500'

const LABEL_CLASS = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

export function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const { mutate: login, isPending, error } = useLogin()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    login({ email: email.trim(), password })
  }

  return (
    <div className="flex items-center justify-center h-screen bg-gray-100 dark:bg-gray-950 px-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        <div className="flex flex-col items-center gap-2 px-6 pt-6 pb-4">
          <div className="w-10 h-10 rounded-lg bg-green-600 flex items-center justify-center">
            <MessagesSquare className="w-5 h-5 text-white" />
          </div>
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">DermicaPro</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">Panel de leads</p>
        </div>

        <div className="px-6 pb-4 space-y-3">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {extractErrorMessage(error)}
            </p>
          )}

          <div>
            <label className={LABEL_CLASS}>Email</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>Contraseña</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              className={FIELD_CLASS}
            />
          </div>
        </div>

        <div className="px-6 pb-6">
          <button
            type="submit"
            disabled={isPending}
            className="w-full py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
          >
            {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Entrar
          </button>
        </div>
      </form>
    </div>
  )
}
