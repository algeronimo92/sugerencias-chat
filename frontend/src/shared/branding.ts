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
// Tonos ya calculados, para que el script inline de index.html los aplique
// antes del primer frame sin repetir el cálculo de contraste.
const SHADES_KEY = 'brand-shades'
const DEFAULT_ICON = '/icon-192.png'
const HEX_RE = /^#[0-9a-f]{6}$/i

/** Contraste mínimo de texto normal (WCAG 1.4.3). */
const MIN_CONTRAST = 4.5
const WHITE: Rgb = [255, 255, 255]
// --surface del tema oscuro (index.css): el fondo sobre el que se lee la marca.
const DARK_SURFACE: Rgb = [0x11, 0x18, 0x1d]

type Rgb = [number, number, number]

export interface BrandShades {
  /** Color del negocio tal cual: decoración, punto de no leído, icono activo. */
  primary: string
  /** Texto de acento y relleno de botones con texto blanco: >= 4,5:1 contra blanco. */
  strong: string
  /** Texto sobre el fondo suave de acento (--accent-soft): >= 4,5:1. */
  deep: string
  /** La marca en tema oscuro: >= 4,5:1 contra --surface oscuro. */
  dark: string
}

const toRgb = (hex: string): Rgb => [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16)) as Rgb
const toHex = (rgb: Rgb) => '#' + rgb.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')

function luminance(rgb: Rgb): number {
  const [r, g, b] = rgb.map(channel => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const [high, low] = [luminance(toRgb(a)), luminance(toRgb(b))].sort((x, y) => y - x)
  return (high + 0.05) / (low + 0.05)
}

/** Mezcla `rgb` hacia `target` en la proporción `amount` (0 = igual, 1 = target). */
const mix = (rgb: Rgb, target: Rgb, amount: number): Rgb =>
  rgb.map((channel, index) => channel + (target[index] - channel) * amount) as Rgb

/**
 * Oscurece (o aclara, según `target`) partiendo de `start` hasta que el tono dé
 * el contraste mínimo contra `background`. Pasos de 2 %: el resultado queda lo
 * más cerca posible del color que eligió el negocio.
 */
function shadeUntilReadable(rgb: Rgb, target: Rgb, start: number, background: string): string {
  for (let amount = start; amount < 1; amount += 0.02) {
    const candidate = toHex(mix(rgb, target, amount))
    if (contrastRatio(candidate, background) >= MIN_CONTRAST) return candidate
  }
  return toHex(target)
}

/**
 * Tonos derivados del color principal. Arrancan en la misma proporción que el
 * verde original (#00a884 → #008069 → #006e5b) y se oscurecen lo que haga
 * falta: con un color claro (amarillo, celeste) esa proporción dejaba el
 * botón primario con texto blanco por debajo de 4,5:1.
 */
export function brandShades(hex: string): BrandShades {
  const color = HEX_RE.test(hex) ? hex.toLowerCase() : DEFAULT_BRAND.primary_color
  // El verde de la plataforma conserva sus tonos de diseño exactos (index.css).
  if (color === DEFAULT_BRAND.primary_color) {
    return { primary: color, strong: '#008069', deep: '#006e5b', dark: color }
  }
  const rgb = toRgb(color)
  const black: Rgb = [0, 0, 0]
  const strong = shadeUntilReadable(rgb, black, 0.24, toHex(WHITE))
  // Mismo cálculo que --accent-soft en index.css: 10 % de marca sobre blanco.
  const soft = toHex(mix(WHITE, rgb, 0.1))
  const deep = shadeUntilReadable(rgb, black, 0.345, soft)
  const dark = shadeUntilReadable(rgb, WHITE, 0, toHex(DARK_SURFACE))
  return { primary: color, strong, deep, dark }
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
  const shades = brandShades(brand.primary_color)
  const { strong } = shades
  const root = document.documentElement.style
  root.setProperty('--brand', shades.primary)
  root.setProperty('--brand-strong', shades.strong)
  root.setProperty('--brand-deep', shades.deep)
  root.setProperty('--brand-dark', shades.dark)
  document.title = brand.name
  setMeta('apple-mobile-web-app-title', brand.name)
  if (!document.documentElement.classList.contains('dark')) setMeta('theme-color', strong)
  const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (icon) icon.href = brand.icon_url ?? DEFAULT_ICON
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(brand))
    localStorage.setItem(SHADES_KEY, JSON.stringify(shades))
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
