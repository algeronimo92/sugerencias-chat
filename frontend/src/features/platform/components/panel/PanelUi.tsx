import { Layers } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../../../../shared/utils/cn'
import { estadoDeNegocio, type TonoEstado } from './businessStatus'

export function MarcaPlataforma() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-wa-primary text-white shadow-[0_8px_24px_rgba(0,168,132,0.24)]">
        <Layers className="h-4.5 w-4.5" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <span>
        <span className="block text-[15px] font-bold leading-tight tracking-[-0.02em] text-wa-text dark:text-white">
          Cliniventas
        </span>
        <span className="block text-xs font-semibold uppercase tracking-[0.08em] text-wa-muted dark:text-wa-muted-dark">
          Panel de plataforma
        </span>
      </span>
    </div>
  )
}

export function AvisoError({ mensaje }: { mensaje: string }) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700 dark:border-red-900/80 dark:bg-red-950/35 dark:text-red-300"
    >
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/60">
        <span className="text-xs font-bold" aria-hidden="true">
          !
        </span>
      </span>
      <span>{mensaje}</span>
    </div>
  )
}

const TONOS: Record<TonoEstado, { pastilla: string; punto: string }> = {
  ok: { pastilla: 'bg-emerald-500/10 text-emerald-700 ring-emerald-500/15 dark:text-emerald-300', punto: 'bg-emerald-500' },
  aviso: { pastilla: 'bg-amber-500/10 text-amber-700 ring-amber-500/15 dark:text-amber-300', punto: 'bg-amber-500' },
  error: { pastilla: 'bg-red-500/10 text-red-700 ring-red-500/15 dark:text-red-300', punto: 'bg-red-500' },
  neutro: { pastilla: 'bg-gray-500/10 text-gray-600 ring-gray-500/15 dark:text-gray-300', punto: 'bg-gray-400' },
}

export function EstadoNegocio({ status }: { status: string }) {
  const { label, tono } = estadoDeNegocio(status)
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset', TONOS[tono].pastilla)}>
      <span className={cn('h-1.5 w-1.5 rounded-full', TONOS[tono].punto)} aria-hidden="true" />
      {label}
    </span>
  )
}

export function InicialNegocio({ nombre, className }: { nombre: string; className?: string }) {
  return (
    <span aria-hidden="true" className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-wa-primary/10 text-sm font-bold text-wa-primary-strong dark:bg-wa-primary/15 dark:text-wa-primary', className)}>
      {nombre.trim().charAt(0).toUpperCase() || 'N'}
    </span>
  )
}

interface TarjetaProps {
  titulo: string
  descripcion?: string
  /** Acción o dato a la derecha del título. */
  accion?: ReactNode
  className?: string
  children: ReactNode
}

/** Bloque de un apartado: título, a qué se refiere y su contenido. */
export function Tarjeta({ titulo, descripcion, accion, className, children }: TarjetaProps) {
  return (
    <section className={cn('rounded-xl border border-wa-border bg-white p-4 sm:p-5 dark:border-wa-border-dark dark:bg-wa-panel-dark', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-wa-text dark:text-white">{titulo}</h3>
          {descripcion && <p className="mt-1 text-xs leading-5 text-wa-muted dark:text-wa-muted-dark">{descripcion}</p>}
        </div>
        {accion && <div className="shrink-0">{accion}</div>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  )
}

export const campoPanelClass = 'h-10 border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-head-dark'
