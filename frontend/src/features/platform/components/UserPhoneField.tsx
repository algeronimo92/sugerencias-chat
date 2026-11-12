import { Loader2, Pencil, Phone } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useUpdateUser } from '../hooks/useUsers'
import type { AppUser } from '../types'
import { settingInputClass } from './SettingField'

/** El WhatsApp del usuario: ahí le llega el aviso de venta cuando es el
 *  responsable de una cita o es admin. Vacío lo borra. */
export function UserPhoneField({ user }: { user: AppUser }) {
  const { mutate: updateUser, isPending, error, reset } = useUpdateUser()
  const [editing, setEditing] = useState(false)
  const [phone, setPhone] = useState(user.phone ?? '')
  const field = useRef<HTMLInputElement>(null)
  const pencil = useRef<HTMLButtonElement>(null)

  // Lo abre un clic en el lápiz: el foco sigue a esa acción, no a la carga.
  useEffect(() => {
    if (editing) field.current?.focus()
  }, [editing])

  function close() {
    reset()
    setEditing(false)
    setTimeout(() => pencil.current?.focus(), 0)
  }

  function save() {
    if (phone.trim() === (user.phone ?? '')) {
      close()
      return
    }
    updateUser({ id: user.id, phone: phone.trim() }, {
      onSuccess: (saved) => {
        close()
        toast.success(saved.phone ? `WhatsApp de ${user.name} guardado` : `${user.name} ya no recibe avisos por WhatsApp`)
      },
    })
  }

  if (!editing) {
    return (
      <p className="flex items-center gap-1 text-xs text-wa-muted dark:text-wa-muted-dark">
        <Phone className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span className="truncate">{user.phone ? `+${user.phone}` : 'Sin WhatsApp para avisos'}</span>
        <button
          ref={pencil}
          type="button"
          onClick={() => {
            setPhone(user.phone ?? '')
            setEditing(true)
          }}
          aria-label={`Cambiar el WhatsApp de ${user.name}`}
          title="Cambiar WhatsApp"
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-wa-hover hover:text-wa-primary-strong focus-visible:ring-2 focus-visible:ring-wa-primary/60 dark:hover:bg-wa-hover-dark dark:hover:text-wa-primary"
        >
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </p>
    )
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') close()
      }}
      className="mt-1 space-y-1.5"
    >
      <div className="flex items-center gap-1.5">
        <input
          ref={field}
          type="tel"
          inputMode="tel"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="927 345 336"
          aria-label={`WhatsApp de ${user.name}`}
          className={settingInputClass + ' min-w-0 py-1 text-xs'}
        />
        <Button type="submit" size="sm" disabled={isPending} className="h-8">
          {isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> : 'Guardar'}
        </Button>
        <Button variant="ghost" size="sm" onClick={close} disabled={isPending} className="h-8">Cancelar</Button>
      </div>
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">{extractErrorMessage(error)}</p>
      ) : (
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">Le llega el aviso de venta de sus citas (y de todas, si es admin). Déjalo vacío para que no le llegue.</p>
      )}
    </form>
  )
}
