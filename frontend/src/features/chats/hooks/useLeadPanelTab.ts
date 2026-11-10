import { useState } from 'react'

// La pestaña abierta es una preferencia de quien usa este navegador, no del
// lead: queda igual al cambiar de chat y al volver a entrar.
const TAB_KEY = 'ficha-lead-pestana'
// Antes el copiloto se plegaba: quien lo tenía plegado entra a la ficha.
const LEGACY_COLLAPSED_KEY = 'copiloto-ia-plegado'

export type PanelTab = 'ficha' | 'copiloto'

function readTab(): PanelTab {
  try {
    const saved = localStorage.getItem(TAB_KEY)
    if (saved === 'ficha' || saved === 'copiloto') return saved
    return localStorage.getItem(LEGACY_COLLAPSED_KEY) === '1' ? 'ficha' : 'copiloto'
  } catch {
    return 'copiloto'
  }
}

export function useLeadPanelTab() {
  const [tab, setTab] = useState<PanelTab>(readTab)
  function choose(next: PanelTab) {
    setTab(next)
    try {
      localStorage.setItem(TAB_KEY, next)
    } catch {
      // localStorage bloqueado: la pestaña vale solo para esta visita.
    }
  }
  return [tab, choose] as const
}
