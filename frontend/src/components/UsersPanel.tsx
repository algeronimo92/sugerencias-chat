import { useState } from 'react'
import { Check, Loader2, ShieldCheck, User as UserIcon } from 'lucide-react'
import type { AppUser, UserRole } from '../types'
import { useMe } from '../hooks/useAuth'
import { useCreateUser, useResetPassword, useUpdateUser, useUsers } from '../hooks/useUsers'
import { extractErrorMessage } from '../utils/errors'

const FIELD_CLASS =
  'w-full text-sm bg-wa-hover dark:bg-wa-head-dark text-wa-text dark:text-wa-text-dark border border-wa-border dark:border-wa-border-dark rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 focus:border-transparent placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark'

function NewUserForm() {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<UserRole>('vendedor')
  const { mutate: createUser, isPending, error } = useCreateUser()
  const [done, setDone] = useState(false)

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    createUser(
      { email: email.trim(), name: name.trim(), password, role },
      {
        onSuccess: () => {
          setEmail('')
          setName('')
          setPassword('')
          setRole('vendedor')
          setDone(true)
          setTimeout(() => setDone(false), 2000)
        },
      }
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-2.5 bg-wa-hover dark:bg-wa-head-dark/60 rounded-lg p-3">
      <p className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide">Nuevo usuario</p>
      {error && <p className="text-xs text-red-500 dark:text-red-400">{extractErrorMessage(error)}</p>}
      <div className="grid grid-cols-2 gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="Email"
          required
          className={FIELD_CLASS}
        />
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nombre"
          required
          className={FIELD_CLASS}
        />
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-2">
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          placeholder="Contraseña"
          required
          className={FIELD_CLASS}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className={FIELD_CLASS}>
          <option value="vendedor">Vendedor</option>
          <option value="admin">Admin</option>
        </select>
      </div>
      <button
        type="submit"
        disabled={isPending}
        className="w-full py-2 text-sm font-medium text-white bg-wa-primary hover:bg-wa-primary-strong disabled:opacity-50 rounded-lg transition-colors flex items-center justify-center gap-1.5"
      >
        {isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
        {done ? <Check className="w-3.5 h-3.5" /> : null}
        Crear usuario
      </button>
    </form>
  )
}

function ResetPasswordControl({ userId }: { userId: number }) {
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const { mutate: resetPassword, isPending, isSuccess } = useResetPassword()

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-wa-muted dark:text-wa-muted-dark hover:text-wa-primary-strong dark:hover:text-wa-primary transition-colors"
      >
        Restablecer contraseña
      </button>
    )
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="Nueva contraseña"
        autoFocus
        className="text-xs bg-white dark:bg-wa-panel-dark border border-wa-border dark:border-wa-border-dark rounded px-2 py-1 outline-none focus:ring-2 focus:ring-wa-primary/60 w-32"
      />
      <button
        type="button"
        onClick={() =>
          resetPassword(
            { id: userId, newPassword: password },
            { onSuccess: () => setPassword('') }
          )
        }
        disabled={isPending || !password}
        className="text-xs px-2 py-1 rounded bg-wa-primary text-white hover:bg-wa-primary-strong disabled:opacity-50 flex items-center gap-1"
      >
        {isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : isSuccess ? <Check className="w-3 h-3" /> : null}
        Guardar
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-xs text-wa-muted hover:text-gray-600 dark:hover:text-gray-300"
      >
        Cancelar
      </button>
    </div>
  )
}

function UserRow({ user, isSelf }: { user: AppUser; isSelf: boolean }) {
  const { mutate: updateUser, isPending, error } = useUpdateUser()

  return (
    <div className="border border-wa-border dark:border-wa-border-dark rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-medium text-wa-text dark:text-wa-text-dark truncate flex items-center gap-1.5">
            {user.role === 'admin' ? (
              <ShieldCheck className="w-3.5 h-3.5 text-wa-primary-strong dark:text-wa-primary shrink-0" />
            ) : (
              <UserIcon className="w-3.5 h-3.5 text-wa-muted shrink-0" />
            )}
            {user.name}
            {isSelf && <span className="text-[10px] text-wa-muted font-normal">(vos)</span>}
          </p>
          <p className="text-xs text-wa-muted dark:text-wa-muted-dark truncate">{user.email}</p>
        </div>
        {!user.is_active && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-wa-field dark:bg-wa-head-dark text-wa-muted dark:text-wa-muted-dark font-medium shrink-0">
            Desactivado
          </span>
        )}
      </div>

      {error && <p className="text-xs text-red-500 dark:text-red-400">{extractErrorMessage(error)}</p>}

      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-1.5">
          <select
            value={user.role}
            disabled={isPending || isSelf}
            onChange={(e) => updateUser({ id: user.id, role: e.target.value as UserRole })}
            className="text-xs rounded-md bg-wa-hover dark:bg-wa-head-dark border border-wa-border
            dark:text-gray-300 dark:border-wa-border-dark px-2 py-1 outline-none disabled:opacity-50"
          >
            <option value="vendedor">Vendedor</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="button"
            disabled={isPending || isSelf}
            onClick={() => updateUser({ id: user.id, is_active: !user.is_active })}
            className="text-xs px-2 py-1 rounded-md border border-wa-border dark:border-wa-border-dark text-gray-600 dark:text-gray-300 hover:bg-wa-hover dark:hover:bg-wa-head-dark disabled:opacity-50 transition-colors"
          >
            {user.is_active ? 'Desactivar' : 'Activar'}
          </button>
        </div>
        <ResetPasswordControl userId={user.id} />
      </div>
    </div>
  )
}

export function UsersPanel() {
  const { data: me } = useMe()
  const { data: users, isLoading, error } = useUsers(true)

  return (
    <div className="space-y-4">
      <NewUserForm />

      <div>
        <h3 className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide mb-2">
          Usuarios
        </h3>
        {isLoading && <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center py-6">Cargando...</p>}
        {error && (
          <p className="text-sm text-red-500 dark:text-red-400 text-center py-6">Error al cargar usuarios.</p>
        )}
        <div className="space-y-2">
          {users?.map((u) => <UserRow key={u.id} user={u} isSelf={u.id === me?.id} />)}
        </div>
      </div>
    </div>
  )
}
