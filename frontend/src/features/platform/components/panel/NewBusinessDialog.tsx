import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Building2, Globe2, KeyRound, Loader2, Mail, Plus, X } from 'lucide-react'
import { useId, useRef, useState, type InputHTMLAttributes, type Ref } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { DialogPrimitive, dialogContentPositionClass, dialogOverlayClass } from '../../../../shared/ui/Dialog'
import { createOrganization } from '../../api'
import { platformKeys } from '../../keys'
import { mensajeDeError } from './errors'
import { AvisoError } from './PanelUi'

export function NewBusinessDialog() {
  const queryClient = useQueryClient();
  const nombreRef = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [name, setName] = useState("");
  const [hostname, setHostname] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const crear = useMutation({
    mutationFn: async () => {
      await createOrganization(name, hostname, adminEmail, adminPassword);
    },
    onSuccess: () => {
      setName("");
      setHostname("");
      setAdminEmail("");
      setAdminPassword("");
      setAbierto(false);
      queryClient.invalidateQueries({ queryKey: platformKeys.organizations });
    },
  });

  return (
    <DialogPrimitive.Root open={abierto} onOpenChange={(open) => { if (!crear.isPending) setAbierto(open); }}>
      <DialogPrimitive.Trigger asChild>
        <Button className="h-11 gap-2 bg-wa-primary-strong px-4 text-sm hover:bg-wa-primary-deep">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo negocio
        </Button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlayClass} />
        <DialogPrimitive.Content className={`${dialogContentPositionClass} max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-2xl overflow-y-auto rounded-xl border border-wa-border bg-white p-5 shadow-xl sm:p-8 dark:border-wa-border-dark dark:bg-wa-panel-dark`} onOpenAutoFocus={(evento) => { evento.preventDefault(); nombreRef.current?.focus(); }} onEscapeKeyDown={(evento) => { if (crear.isPending) evento.preventDefault(); }} onPointerDownOutside={(evento) => { if (crear.isPending) evento.preventDefault(); }}>
      <form
        onSubmit={(evento) => {
          evento.preventDefault();
          crear.mutate();
        }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="flex gap-4">
            <span className="hidden h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-wa-primary/10 text-wa-primary-strong sm:flex dark:bg-wa-primary/15 dark:text-wa-primary">
              <Building2 className="h-5 w-5" aria-hidden="true" />
            </span>
            <div>
              <DialogPrimitive.Title className="text-xl font-bold tracking-[-0.025em] text-wa-text dark:text-white">Crear negocio</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1.5 max-w-lg text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                Prepara el espacio y el dominio principal. La cuenta administradora es opcional.
              </DialogPrimitive.Description>
            </div>
          </div>
          <button type="button" onClick={() => setAbierto(false)} disabled={crear.isPending} aria-label="Cerrar" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted hover:bg-wa-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark">
            <X className="h-4.5 w-4.5" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-7 grid gap-5 sm:grid-cols-2">
          <CampoNegocio ref={nombreRef} label="Nombre" icon={Building2} value={name} onChange={(evento) => setName(evento.target.value)} placeholder="Clínica Norte" required />
          <CampoNegocio label="Dominio principal" icon={Globe2} value={hostname} onChange={(evento) => setHostname(evento.target.value)} placeholder="norte.cliniventas.com" required />
          <CampoNegocio label="Correo del administrador" icon={Mail} optional type="email" value={adminEmail} onChange={(evento) => setAdminEmail(evento.target.value)} placeholder="admin@clinicanorte.com" />
          <CampoNegocio label="Contraseña inicial" icon={KeyRound} optional type="password" minLength={8} value={adminPassword} onChange={(evento) => setAdminPassword(evento.target.value)} placeholder="Mínimo 8 caracteres" />
        </div>

        {crear.isError && <div className="mt-5"><AvisoError mensaje={mensajeDeError(crear.error)} /></div>}

        <div className="mt-7 flex flex-col-reverse gap-3 border-t border-wa-border pt-5 sm:flex-row sm:items-center sm:justify-end dark:border-white/10">
          <button type="button" onClick={() => setAbierto(false)} disabled={crear.isPending} className="h-11 rounded-xl border border-wa-border px-5 text-sm font-semibold text-wa-muted transition hover:bg-gray-50 hover:text-wa-text disabled:opacity-50 dark:border-white/10 dark:text-wa-muted-dark dark:hover:bg-white/5 dark:hover:text-white">Cancelar</button>
          <button type="submit" disabled={crear.isPending} className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-wa-primary-strong px-5 text-sm font-semibold text-white transition hover:bg-wa-primary-deep focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:cursor-wait disabled:opacity-60">
            {crear.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {crear.isPending ? "Preparando negocio…" : "Crear negocio"}
          </button>
        </div>
      </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface CampoNegocioProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string
  icon: typeof Building2
  optional?: boolean
  ref?: Ref<HTMLInputElement>
}

function CampoNegocio({ label, icon: Icon, optional = false, ref, ...input }: CampoNegocioProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="mb-2 flex items-center justify-between text-sm font-semibold text-wa-text dark:text-wa-text-dark">
        {label}
        {optional && <span className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">Opcional</span>}
      </label>
      <span className="flex overflow-hidden rounded-xl border border-wa-border bg-gray-50/70 transition focus-within:border-wa-primary focus-within:bg-white focus-within:ring-4 focus-within:ring-wa-primary/10 dark:border-white/10 dark:bg-[#0b0e18] dark:focus-within:border-wa-primary dark:focus-within:bg-[#0b0e18]">
        <span className="flex w-11 shrink-0 items-center justify-center border-r border-wa-border text-wa-muted dark:border-white/10 dark:text-wa-muted-dark"><Icon className="h-4 w-4" aria-hidden="true" /></span>
        <input id={id} ref={ref} className="h-11 w-full bg-transparent px-3 text-sm text-wa-text outline-none placeholder:text-wa-muted/70 dark:text-white" {...input} />
      </span>
    </div>
  );
}
