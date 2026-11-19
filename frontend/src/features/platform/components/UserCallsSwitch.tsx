import { PhoneCall } from 'lucide-react'
import { useId } from 'react'
import { toast } from 'sonner'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useUpdateUser } from '../hooks/useUsers'
import type { AppUser } from '../types'

/** "Atiende llamadas": a quién le suenan las llamadas de WhatsApp y quién
 *  puede llamar a un cliente. Se decide persona por persona. */
export function UserCallsSwitch({ user }: { user: AppUser }) {
  const id = useId()
  const { mutate: updateUser, isPending } = useUpdateUser()
  const checked = user.can_handle_calls

  function toggle() {
    const next = !checked
    updateUser({ id: user.id, can_handle_calls: next }, {
      onSuccess: () => toast.success(next ? `${user.name} atenderá llamadas` : `${user.name} ya no atiende llamadas`),
      onError: (error) => toast.error(extractErrorMessage(error)),
    })
  }

  return (
    <div className="inline-flex min-h-11 items-center gap-2 text-xs text-wa-text dark:text-wa-text-dark">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${user.name} atiende llamadas`}
        disabled={isPending}
        onClick={toggle}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-wa-primary-strong disabled:cursor-wait disabled:opacity-60 ${checked ? 'bg-wa-primary-strong' : 'bg-wa-muted/40 dark:bg-wa-muted-dark/40'}`}
      >
        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5' : 'translate-x-0.5'}`} />
      </button>
      <PhoneCall className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <label htmlFor={id}>{checked ? 'Atiende llamadas' : 'No atiende llamadas'}</label>
    </div>
  )
}
