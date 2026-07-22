import type { LeadStage } from '../types'

export const LEAD_STAGE_META: Record<LeadStage, {
  label: string
  dot: string
  accent: string
  header: string
  badge: string
}> = {
  nuevo: { label: 'Nuevo', dot: 'bg-sky-500', accent: 'text-sky-500', header: 'border-sky-400', badge: 'bg-sky-100 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' },
  en_diagnostico: { label: 'En diagnóstico', dot: 'bg-indigo-500', accent: 'text-indigo-500', header: 'border-indigo-400', badge: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300' },
  calificado: { label: 'Calificado', dot: 'bg-cyan-500', accent: 'text-cyan-500', header: 'border-cyan-400', badge: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950/50 dark:text-cyan-300' },
  oferta_presentada: { label: 'Oferta presentada', dot: 'bg-violet-500', accent: 'text-violet-500', header: 'border-violet-400', badge: 'bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300' },
  en_objecion: { label: 'En objeción', dot: 'bg-amber-500', accent: 'text-amber-500', header: 'border-amber-400', badge: 'bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  agendado: { label: 'Agendado', dot: 'bg-blue-500', accent: 'text-blue-500', header: 'border-blue-400', badge: 'bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' },
  cliente_activo: { label: 'Cliente activo', dot: 'bg-green-500', accent: 'text-green-500', header: 'border-green-400', badge: 'bg-green-100 text-green-700 dark:bg-green-950/50 dark:text-green-300' },
  postventa: { label: 'Postventa', dot: 'bg-emerald-500', accent: 'text-emerald-500', header: 'border-emerald-400', badge: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' },
  en_seguimiento: { label: 'En seguimiento', dot: 'bg-slate-500', accent: 'text-slate-500', header: 'border-slate-400', badge: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300' },
  en_nutricion: { label: 'En nutrición', dot: 'bg-fuchsia-500', accent: 'text-fuchsia-500', header: 'border-fuchsia-400', badge: 'bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-950/50 dark:text-fuchsia-300' },
  perdido: { label: 'Perdido', dot: 'bg-rose-500', accent: 'text-rose-500', header: 'border-rose-400', badge: 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300' },
  descalificado: { label: 'Descalificado', dot: 'bg-stone-500', accent: 'text-stone-500', header: 'border-stone-400', badge: 'bg-stone-100 text-stone-700 dark:bg-stone-800 dark:text-stone-300' },
  baja: { label: 'Baja', dot: 'bg-gray-500', accent: 'text-gray-500', header: 'border-gray-400', badge: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300' },
}
