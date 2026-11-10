import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'

/**
 * Pestaña, período y a quién se mira viven en la dirección del dashboard:
 * `/dashboard?pestana=ventas&dias=7&vendedora=12`. Así un reporte se comparte
 * con un enlace y refrescar no lo pierde. La última combinación también se
 * guarda en el navegador, para que entrar desde el menú (sin parámetros)
 * vuelva a donde se estaba.
 */

export const TAB_SLUGS = {
  summary: 'resumen',
  flows: 'flujos',
  tags: 'etiquetas',
  pipeline: 'embudo',
  sales: 'ventas',
} as const

export type TabId = keyof typeof TAB_SLUGS
export const PERIODS = [7, 30, 90] as const

/** 'mine' y 'team' son los alcances de siempre; un número es una vendedora. */
export type DashboardView = 'mine' | 'team' | number

const STORAGE_KEY = 'dashboard-filtros'
const PARAMS = ['pestana', 'dias', 'alcance', 'vendedora'] as const

function tabFrom(slug: string | null): TabId {
  const found = (Object.entries(TAB_SLUGS) as [TabId, string][]).find(([, value]) => value === slug)
  return found ? found[0] : 'summary'
}

function daysFrom(value: string | null): number {
  const days = Number(value)
  return (PERIODS as readonly number[]).includes(days) ? days : 30
}

function viewFrom(params: URLSearchParams, isAdmin: boolean): DashboardView {
  const seller = Number(params.get('vendedora'))
  if (Number.isInteger(seller) && seller > 0) return seller
  const scope = params.get('alcance')
  if (scope === 'mio') return 'mine'
  if (scope === 'equipo') return 'team'
  // El admin entra viendo el total y el vendedor lo suyo.
  return isAdmin ? 'team' : 'mine'
}

function readSaved(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

function save(query: string) {
  try {
    localStorage.setItem(STORAGE_KEY, query)
  } catch {
    // Sin almacenamiento solo se pierde el recuerdo; la dirección sigue.
  }
}

export function useDashboardFilters(isAdmin: boolean) {
  const [params, setParams] = useSearchParams()
  const hasFilters = PARAMS.some((key) => params.has(key))

  // Sin parámetros en la dirección se restaura la última vista guardada.
  useEffect(() => {
    if (hasFilters) return
    const saved = readSaved()
    if (saved) setParams(new URLSearchParams(saved), { replace: true })
  }, [hasFilters, setParams])

  const tab = tabFrom(params.get('pestana'))
  const days = daysFrom(params.get('dias'))
  const view = viewFrom(params, isAdmin)

  function update(changes: { tab?: TabId; days?: number; view?: DashboardView }) {
    const next = new URLSearchParams(params)
    const nextTab = changes.tab ?? tab
    const nextDays = changes.days ?? days
    const nextView = changes.view ?? view
    next.set('pestana', TAB_SLUGS[nextTab])
    next.set('dias', String(nextDays))
    next.delete('alcance')
    next.delete('vendedora')
    if (typeof nextView === 'number') next.set('vendedora', String(nextView))
    else next.set('alcance', nextView === 'mine' ? 'mio' : 'equipo')
    save(next.toString())
    // Reemplaza en vez de apilar: el botón atrás vuelve a la pantalla
    // anterior, no a cada filtro que se tocó.
    setParams(next, { replace: true })
  }

  return {
    tab,
    days,
    view,
    setTab: (value: TabId) => update({ tab: value }),
    setDays: (value: number) => update({ days: value }),
    setView: (value: DashboardView) => update({ view: value }),
  }
}
