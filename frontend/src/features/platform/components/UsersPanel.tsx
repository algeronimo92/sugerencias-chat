import {
  BarChart3,
  CheckCircle2,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  MailWarning,
  Pencil,
  ShieldCheck,
  User as UserIcon,
  UserPlus,
  Users,
  UserX,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { UserRole } from '../../../shared/types'
import { Badge, Button, ConfirmDialog, EmptyState, Select, Skeleton, labelClass } from '../../../shared/ui'
import { copyText } from '../../../shared/utils/clipboard'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import {
  useCreateInvitationLink,
  useCreateUser,
  useResendInvitation,
  useSendPasswordReset,
  useUpdateUser,
  useUsers,
} from '../hooks/useUsers'
import type { AppUser } from '../types'
import { settingInputClass } from './SettingField'
import { UserPhoneField } from './UserPhoneField'

const ROLE_LABEL: Record<UserRole, string> = { admin: 'Admin', vendedor: 'Vendedor', analista: 'Analista' }
const ANALYST_HELP = 'Solo verá el dashboard: sin chats, leads ni tareas.'

/** Los tres estados reales de una cuenta. `is_active` solo no alcanza: una
 *  invitación que nadie aceptó y una persona desactivada comparten `false`. */
type UserStatus = 'pending' | 'active' | 'inactive'
const statusOf = (u: AppUser): UserStatus => (u.invitation_pending ? 'pending' : u.is_active ? 'active' : 'inactive')
const STATUS_RANK: Record<UserStatus, number> = { pending: 0, active: 1, inactive: 2 }

function StatusBadge({ status }: { status: UserStatus }) {
  if (status === 'pending') {
    return (
      <Badge variant="warning" size="md">
        <MailWarning className="h-3 w-3" aria-hidden="true" />
        Invitación pendiente
      </Badge>
    )
  }
  if (status === 'inactive') {
    return (
      <Badge variant="neutral" size="md" className="text-wa-faint-strong dark:text-wa-text-dark">
        <UserX className="h-3 w-3" aria-hidden="true" />
        Desactivado
      </Badge>
    )
  }
  // Verde propio en vez de `success`: la variante compartida queda bajo AA en claro.
  return (
    <Badge size="md" className="bg-green-50 font-semibold text-green-800 dark:bg-green-950/60 dark:text-green-200">
      <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
      Activo
    </Badge>
  )
}

function RoleIcon({ role }: { role: UserRole }) {
  const base = 'h-3.5 w-3.5 shrink-0'
  if (role === 'admin') return <ShieldCheck className={`${base} text-wa-primary-strong dark:text-wa-primary`} aria-hidden="true" />
  if (role === 'analista') return <BarChart3 className={`${base} text-wa-muted dark:text-wa-muted-dark`} aria-label="Solo dashboard" />
  return <UserIcon className={`${base} text-wa-muted dark:text-wa-muted-dark`} aria-hidden="true" />
}

function NewUserForm({ onSent }: { onSent: () => void }) {
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState<UserRole>('vendedor')
  const { mutate: createUser, isPending, error } = useCreateUser()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const to = email.trim()
    createUser(
      { email: to, name: name.trim(), role },
      {
        onSuccess: () => {
          toast.success(`Invitación enviada a ${to}`, { description: 'Le llega un enlace para crear su contraseña.' })
          setEmail('')
          setName('')
          setRole('vendedor')
          onSent()
        },
      }
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg bg-wa-hover p-3 dark:bg-wa-head-dark/60">
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{extractErrorMessage(error)}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <label className="block">
          <span className={labelClass}>Correo</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className={settingInputClass + ' w-full'} />
        </label>
        <label className="block">
          <span className={labelClass}>Nombre</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required className={settingInputClass + ' w-full'} />
        </label>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[auto_1fr] sm:items-end">
        <label className="block">
          <span className={labelClass}>Rol</span>
          <Select value={role} onChange={(e) => setRole(e.target.value as UserRole)} className="w-40 text-sm">
            <option value="vendedor">Vendedor</option>
            <option value="admin">Admin</option>
            <option value="analista">Analista</option>
          </Select>
        </label>
        <p className="pb-2 text-xs leading-relaxed text-wa-muted dark:text-wa-muted-dark">
          {role === 'analista' ? `${ANALYST_HELP} ` : ''}Le enviaremos un enlace seguro para crear su contraseña.
        </p>
      </div>
      <Button type="submit" disabled={isPending} className="w-full">
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Mail className="h-4 w-4" aria-hidden="true" />}
        Enviar invitación
      </Button>
    </form>
  )
}

function EmailEditor({ user, onSave, onCancel, isPending }: { user: AppUser; onSave: (email: string) => void; onCancel: () => void; isPending: boolean }) {
  const [email, setEmail] = useState(user.email)
  const unchanged = email.trim().toLowerCase() === user.email
  const field = useRef<HTMLInputElement>(null)
  // Lo abre un clic en el lápiz: el foco sigue a esa acción, no a la carga.
  useEffect(() => field.current?.focus(), [])

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        if (unchanged) onCancel()
        else onSave(email.trim())
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
      className="mt-1 space-y-1.5"
    >
      <div className="flex items-center gap-1.5">
        <input ref={field} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required aria-label="Correo" className={settingInputClass + ' min-w-0 py-1 text-xs'} />
        <Button type="submit" size="sm" disabled={isPending} className="h-8">
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : 'Guardar'}
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={isPending} className="h-8">Cancelar</Button>
      </div>
      <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Al guardar, la invitación enviada al correo anterior deja de valer.</p>
    </form>
  )
}

/** Acciones de correo por estado: reenviar o copiar enlace mientras la
 *  invitación está pendiente; enlace para nueva contraseña cuando ya entró. */
function EmailActions({ user, status }: { user: AppUser; status: UserStatus }) {
  const resend = useResendInvitation()
  const reset = useSendPasswordReset()
  const link = useCreateInvitationLink()
  const fail = (err: unknown) => toast.error(extractErrorMessage(err))

  async function copyLink() {
    let issued: { url: string; expires_at: string }
    try {
      issued = await link.mutateAsync(user.id)
    } catch (err) {
      fail(err)
      return
    }
    const expiry = new Date(issued.expires_at).toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' })
    const description = `Vence el ${expiry}. El enlace que se mandó antes por correo dejó de valer.`
    if (await copyText(issued.url)) {
      toast.success('Enlace de invitación copiado', { description })
      return
    }
    // Sin portapapeles, el enlace se muestra entero para seleccionarlo a mano.
    toast.error('No se pudo copiar el enlace', { description: issued.url, duration: 15000 })
  }

  if (status === 'inactive') return null
  if (status === 'active') {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="h-9 px-3"
        disabled={reset.isPending}
        onClick={() => reset.mutate(user.id, { onSuccess: () => toast.success(`Enlace para nueva contraseña enviado a ${user.email}`), onError: fail })}
      >
        {reset.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <KeyRound className="h-3.5 w-3.5" aria-hidden="true" />}
        Enviar enlace para nueva contraseña
      </Button>
    )
  }
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        className="h-9 px-3"
        disabled={resend.isPending}
        onClick={() => resend.mutate(user.id, { onSuccess: () => toast.success(`Invitación reenviada a ${user.email}`), onError: fail })}
      >
        {resend.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Mail className="h-3.5 w-3.5" aria-hidden="true" />}
        Reenviar invitación
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className="h-9 px-3"
        disabled={link.isPending}
        onClick={copyLink}
        title="Crea un enlace nuevo y lo copia. El que se mandó antes deja de valer."
      >
        {link.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
        Copiar enlace nuevo
      </Button>
    </>
  )
}

function UserRow({ user, isSelf }: { user: AppUser; isSelf: boolean }) {
  const status = statusOf(user)
  const { mutate: updateUser, isPending, error, reset } = useUpdateUser()
  const [editingEmail, setEditingEmail] = useState(false)
  const pencil = useRef<HTMLButtonElement>(null)

  function closeEmail() {
    reset()
    setEditingEmail(false)
    // El campo se desmonta: el foco vuelve a lo que lo abrió, no al body.
    setTimeout(() => pencil.current?.focus(), 0)
  }

  function saveEmail(email: string) {
    updateUser({ id: user.id, email }, {
      onSuccess: () => {
        closeEmail()
        toast.info('Correo actualizado', { description: 'La invitación anterior dejó de valer: reenvíala o copia un enlace nuevo.' })
      },
    })
  }

  function changeRole(role: UserRole) {
    updateUser({ id: user.id, role }, {
      onSuccess: () => toast.success(`${user.name} ahora es ${ROLE_LABEL[role]}`, { description: role === 'analista' ? ANALYST_HELP : undefined }),
    })
  }

  function setActive(is_active: boolean) {
    updateUser({ id: user.id, is_active }, {
      onSuccess: () => toast.success(is_active ? `${user.name} vuelve a tener acceso` : `${user.name} desactivado`),
    })
  }

  const inactive = status === 'inactive'
  return (
    <div className={`space-y-2 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark ${inactive ? 'bg-wa-hover dark:bg-wa-head-dark/40' : ''}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className={`flex min-w-0 items-center gap-1.5 text-sm font-semibold break-words ${inactive ? 'text-wa-muted dark:text-wa-muted-dark' : 'text-wa-text dark:text-wa-text-dark'}`}>
            <RoleIcon role={user.role} />
            {user.name}
            {isSelf && <span className="text-xs font-normal text-wa-muted dark:text-wa-muted-dark">(tú)</span>}
          </p>
          {editingEmail ? (
            <EmailEditor user={user} onSave={saveEmail} onCancel={closeEmail} isPending={isPending} />
          ) : (
            <p className="flex items-center gap-0.5 text-xs text-wa-muted dark:text-wa-muted-dark">
              <span className="truncate">{user.email}</span>
              {status === 'pending' && (
                <button
                  ref={pencil}
                  type="button"
                  onClick={() => setEditingEmail(true)}
                  aria-label={`Cambiar el correo de ${user.name}`}
                  title="Cambiar correo"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-wa-hover hover:text-wa-primary-strong focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:hover:bg-wa-hover-dark dark:hover:text-wa-primary"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </p>
          )}
          {!inactive && user.role !== 'analista' && <UserPhoneField user={user} />}
          {status === 'pending' && !editingEmail && (
            <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">Todavía no creó su contraseña. Si no le llegó el correo, reenvíale la invitación o pásale el enlace por WhatsApp.</p>
          )}
          {inactive && <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">Sin acceso al CRM. Puedes reactivarlo cuando quieras.</p>}
        </div>
        <div className="shrink-0"><StatusBadge status={status} /></div>
      </div>

      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{extractErrorMessage(error)}</p>}

      {isSelf ? (
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
          <span className="font-medium text-wa-text dark:text-wa-text-dark">{ROLE_LABEL[user.role]}</span> · Tu propio rol y acceso los cambia otro admin.
        </p>
      ) : (
        <div className="flex items-center gap-2">
          {inactive && (
            <Button variant="secondary" size="sm" className="h-9 px-3" disabled={isPending} onClick={() => setActive(true)}>Reactivar</Button>
          )}
          <Select value={user.role} disabled={isPending} aria-label={`Rol de ${user.name}`} onChange={(e) => changeRole(e.target.value as UserRole)} className="w-36 shrink-0 text-xs">
            <option value="vendedor">Vendedor</option>
            <option value="admin">Admin</option>
            <option value="analista">Analista</option>
          </Select>
          {status === 'active' && (
            <ConfirmDialog
              title={`¿Desactivar a ${user.name}?`}
              description="Perderá el acceso al CRM y se cerrarán sus sesiones. Podrás reactivarlo cuando quieras."
              confirmLabel="Desactivar"
              onConfirm={() => setActive(false)}
            >
              <Button variant="ghost" size="sm" className="h-9 px-3" disabled={isPending}>Desactivar</Button>
            </ConfirmDialog>
          )}
        </div>
      )}
      {status !== 'inactive' && (
        <div className="flex flex-wrap gap-2"><EmailActions user={user} status={status} /></div>
      )}
    </div>
  )
}

function UserSkeleton() {
  return (
    <div className="space-y-2 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="h-3 w-56" />
      <Skeleton className="h-9 w-full" />
    </div>
  )
}

export function UsersPanel() {
  const { data: me } = useMe()
  const { data: users, isLoading, error, refetch } = useUsers(true)
  // Invitar es esporádico en una clínica: la lista va primero. Salvo que
  // solo estés tú, donde invitar al equipo es la tarea.
  const [formOpen, setFormOpen] = useState<boolean | null>(null)
  const showForm = formOpen ?? (users !== undefined && users.length <= 1)
  // Lo que pide acción (invitaciones pendientes) arriba; lo apagado, al final.
  const sorted = users ? [...users].sort((a, b) => STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)] || a.name.localeCompare(b.name)) : []

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
          Usuarios{users ? ` · ${users.length}` : ''}
        </h3>
        <Button variant={showForm ? 'ghost' : 'secondary'} size="sm" aria-expanded={showForm} onClick={() => setFormOpen(!showForm)}>
          <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />
          Nuevo usuario
        </Button>
      </div>
      {showForm && <NewUserForm onSent={() => setFormOpen(false)} />}

      {isLoading && (
        <div className="space-y-2" aria-busy="true" role="status" aria-label="Cargando usuarios">
          <UserSkeleton /><UserSkeleton /><UserSkeleton />
        </div>
      )}
      {error && (
        <div role="alert" className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          No se pudieron cargar los usuarios.
          <Button variant="secondary" size="sm" onClick={() => refetch()}>Reintentar</Button>
        </div>
      )}
      <div className="space-y-2">
        {sorted.map((u) => <UserRow key={u.id} user={u} isSelf={!me || u.id === me.id} />)}
      </div>
      {users?.length === 1 && (
        <EmptyState icon={Users} title="Solo estás tú" description="Invita a tu equipo: cada persona recibe un enlace para crear su contraseña." className="py-6" />
      )}
    </div>
  )
}
