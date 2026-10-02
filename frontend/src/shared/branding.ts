/**
 * Marca del negocio: nombre, color principal y logo.
 *
 * La resuelve el backend por el dominio (/api/branding), así que funciona
 * antes del login. Se aplica fuera de React —variables CSS, título, favicon,
 * color de la barra del sistema— y se guarda en localStorage para que la
 * próxima carga pinte con la marca correcta desde el primer frame (ver el
 * script de index.html, que lee la misma clave).
 */
import { useSyncExternalStore } from 'react'

export interface Brand {
  name: string
  primary_color: string
  logo_url: string | null
  icon_url: string | null
}

export const DEFAULT_BRAND: Brand = {
  name: 'Cliniventas',
  primary_color: '#00a884',
  logo_url: null,
  icon_url: null,
}

// La misma clave la lee el script inline de index.html.
const STORAGE_KEY = 'brand'
const DEFAULT_ICON = '/icon-192.png'
const HEX_RE = /^#[0-9a-f]{6}$/i

/**
 * Tonos derivados del color principal, en la misma proporción que el verde
 * original (#00a884 → #008069 → #006e5b): encabezado/hover y presionado.
 */
export function brandShades(hex: string): { primary: string; strong: string; deep: string } {
  const color = HEX_RE.test(hex) ? hex.toLowerCase() : DEFAULT_BRAND.primary_color
  // El verde de la plataforma conserva sus tonos de diseño exactos (index.css).
  if (color === DEFAULT_BRAND.primary_color) return { primary: color, strong: '#008069', deep: '#006e5b' }
  const darken = (factor: number) =>
    '#' +
    [1, 3, 5]
      .map(index => Math.round(parseInt(color.slice(index, index + 2), 16) * factor).toString(16).padStart(2, '0'))
      .join('')
  return { primary: color, strong: darken(0.76), deep: darken(0.655) }
}

let current: Brand = readStored() ?? DEFAULT_BRAND
const listeners = new Set<() => void>()

function readStored(): Brand | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<Brand> | null
    if (parsed && typeof parsed.name === 'string' && typeof parsed.primary_color === 'string') {
      return { ...DEFAULT_BRAND, ...parsed } as Brand
    }
  } catch {
    // localStorage bloqueado o valor corrupto: se usa la marca por defecto.
  }
  return null
}

function setMeta(name: string, content: string) {
  document.querySelector(`meta[name="${name}"]`)?.setAttribute('content', content)
}

/** Color de la barra del sistema en tema claro: el encabezado de la app. */
export function lightThemeColor(): string {
  return brandShades(current.primary_color).strong
}

export function applyBrand(brand: Brand) {
  current = brand
  const { primary, strong, deep } = brandShades(brand.primary_color)
  const root = document.documentElement.style
  root.setProperty('--color-wa-primary', primary)
  root.setProperty('--color-wa-primary-strong', strong)
  root.setProperty('--color-wa-primary-deep', deep)
  document.title = brand.name
  setMeta('apple-mobile-web-app-title', brand.name)
  if (!document.documentElement.classList.contains('dark')) setMeta('theme-color', strong)
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (icon) icon.href = brand.icon_url ?? DEFAULT_ICON
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(brand))
  } catch {
    // Sin almacenamiento la marca se aplica igual; solo se pierde el caché.
  }
  listeners.forEach(listener => listener())
}

/** Pide la marca del dominio actual; si falla, se queda con la guardada. */
export async function loadBrand(): Promise<void> {
  try {
    const response = await fetch('/api/branding', { credentials: 'same-origin' })
    if (!response.ok) return
    const brand = (await response.json()) as Brand
    if (typeof brand.name === 'string' && HEX_RE.test(brand.primary_color)) applyBrand(brand)
  } catch {
    // Sin red (PWA offline): la marca guardada ya está aplicada.
  }
}

/** Nombre del negocio para textos fuera de componentes (utilidades, toasts). */
export function currentBrandName(): string {
  return current.name
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useBrand(): Brand {
  return useSyncExternalStore(subscribe, () => current, () => current)
}
