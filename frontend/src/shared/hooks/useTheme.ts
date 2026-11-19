import { useEffect, useState } from 'react'
import { lightThemeColor } from '../branding'

type Theme = 'light' | 'dark'

const STORAGE_KEY = 'theme'

/* Color de la interfaz del navegador (barra de direcciones móvil, título de PWA).
   Debe coincidir con la barra superior real de la app:
   claro → --brand-strong (el tono del color del negocio), oscuro → --surface-raised. */
const THEME_COLOR: Record<Theme, () => string> = {
  light: lightThemeColor,
  dark: () => '#182127',
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'light' || stored === 'dark') return stored
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(getInitialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark')
    localStorage.setItem(STORAGE_KEY, theme)
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', THEME_COLOR[theme]())
  }, [theme])

  function toggleTheme() {
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'))
  }

  return { theme, toggleTheme }
}
