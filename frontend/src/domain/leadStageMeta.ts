import type { CSSProperties } from 'react'
import type { LeadStage, LeadStageDefinition, LeadStageKind } from '../types'

/**
 * Etapas del embudo. Cada negocio administra las suyas (Catálogos › Etapas) y
 * las pantallas las leen con `useLeadStages`; este módulo solo aporta lo que
 * no depende del negocio: el respaldo mientras cargan, la paleta de colores y
 * cómo se pinta una etapa a partir de su color.
 */

/** Etapa por la que entra todo lead. No se puede borrar ni desactivar. */
export const INITIAL_LEAD_STAGE: LeadStage = 'nuevo'

export const LEAD_STAGE_KIND_LABELS: Record<LeadStageKind, string> = {
  open: 'En curso',
  won: 'Ganada',
  lost: 'Perdida',
}

export const LEAD_STAGE_KIND_HINTS: Record<LeadStageKind, string> = {
  open: 'El lead sigue avanzando en el embudo.',
  won: 'Venta concretada o cliente activo.',
  lost: 'Sale del embudo sin venta: al mover un lead aquí se pide la razón.',
}

/**
 * Paleta ofrecida al elegir el color de una etapa. Son tonos medios (500 de
 * Tailwind): se leen como punto y borde en claro y en oscuro, y la insignia
 * deriva de ellos un fondo suave y un texto con contraste suficiente (ver
 * STAGE_BADGE_CLASS). Un selector libre permitiría colores casi blancos o
 * casi negros que no se leerían en uno de los dos temas.
 */
export const LEAD_STAGE_COLORS: readonly { value: string; label: string }[] = [
  { value: '#0ea5e9', label: 'Celeste' },
  { value: '#3b82f6', label: 'Azul' },
  { value: '#6366f1', label: 'Índigo' },
  { value: '#8b5cf6', label: 'Violeta' },
  { value: '#d946ef', label: 'Fucsia' },
  { value: '#ec4899', label: 'Rosa' },
  { value: '#f43f5e', label: 'Rojo' },
  { value: '#f97316', label: 'Naranja' },
  { value: '#f59e0b', label: 'Ámbar' },
  { value: '#84cc16', label: 'Lima' },
  { value: '#22c55e', label: 'Verde' },
  { value: '#10b981', label: 'Esmeralda' },
  { value: '#14b8a6', label: 'Turquesa' },
  { value: '#06b6d4', label: 'Cian' },
  { value: '#64748b', label: 'Pizarra' },
  { value: '#78716c', label: 'Piedra' },
  { value: '#6b7280', label: 'Gris' },
]

const FALLBACK_COLOR = '#6b7280'

function seed(key: string, name: string, color: string, kind: LeadStageKind, position: number): LeadStageDefinition {
  return { key, name, color, kind, position, is_active: true, description: null, is_system: key === INITIAL_LEAD_STAGE }
}

/** Las etapas con las que nace todo negocio (migración d9e2a4c7f1b5). Sirven
 *  de respaldo mientras llegan las del negocio o si la consulta falla. */
export const DEFAULT_LEAD_STAGES: readonly LeadStageDefinition[] = [
  seed('nuevo', 'Nuevo', '#0ea5e9', 'open', 0),
  seed('en_diagnostico', 'En diagnóstico', '#6366f1', 'open', 1),
  seed('calificado', 'Calificado', '#06b6d4', 'open', 2),
  seed('oferta_presentada', 'Oferta presentada', '#8b5cf6', 'open', 3),
  seed('en_objecion', 'En objeción', '#f59e0b', 'open', 4),
  seed('agendado', 'Agendado', '#3b82f6', 'open', 5),
  seed('cliente_activo', 'Cliente activo', '#22c55e', 'won', 6),
  seed('postventa', 'Postventa', '#10b981', 'won', 7),
  seed('en_seguimiento', 'En seguimiento', '#64748b', 'open', 8),
  seed('en_nutricion', 'En nutrición', '#d946ef', 'open', 9),
  seed('perdido', 'Perdido', '#f43f5e', 'lost', 10),
  seed('descalificado', 'Descalificado', '#78716c', 'lost', 11),
  seed('baja', 'Baja', '#6b7280', 'lost', 12),
]

/** "en_diagnostico" -> "En diagnostico": para una clave que el negocio ya no
 *  tiene (p. ej. una etapa borrada que sigue en el historial). */
export function humanizeStageKey(key: string): string {
  const text = key.replaceAll('_', ' ').trim()
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : key
}

function unknownStage(key: LeadStage): LeadStageDefinition {
  return {
    key,
    name: humanizeStageKey(key),
    color: FALLBACK_COLOR,
    kind: 'open',
    position: Number.MAX_SAFE_INTEGER,
    is_active: false,
    description: null,
    is_system: false,
  }
}

export interface LeadStageCatalog {
  /** Todas, en el orden del embudo (incluye las inactivas). */
  stages: readonly LeadStageDefinition[]
  /** Solo las que se ofrecen como destino al mover un lead. */
  active: readonly LeadStageDefinition[]
  /** Nunca falla: una clave desconocida vuelve con nombre legible y gris. */
  get: (key: LeadStage) => LeadStageDefinition
  label: (key: LeadStage) => string
  isLost: (key: LeadStage) => boolean
}

export function buildStageCatalog(stages: readonly LeadStageDefinition[]): LeadStageCatalog {
  const ordered = [...stages].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key))
  const byKey = new Map(ordered.map(stage => [stage.key, stage]))
  const get = (key: LeadStage) => byKey.get(key) ?? unknownStage(key)
  return {
    stages: ordered,
    active: ordered.filter(stage => stage.is_active),
    get,
    label: key => get(key).name,
    isLost: key => get(key).kind === 'lost',
  }
}

/** Destinos para un selector de "mover a": las activas y, si el valor actual
 *  es una etapa desactivada, también esa (para que el selector la muestre). */
export function stageOptions(catalog: LeadStageCatalog, current?: LeadStage | null): LeadStageDefinition[] {
  const options = [...catalog.active]
  if (current && !options.some(stage => stage.key === current)) options.push(catalog.get(current))
  return options
}

/** Columnas del kanban: las etapas activas y, de las desactivadas (o que el
 *  negocio ya no tiene), solo las que todavía tienen leads: si no, esos leads
 *  quedarían invisibles. */
export function kanbanColumns(catalog: LeadStageCatalog, counts: Record<string, number>): LeadStageDefinition[] {
  const columns = catalog.stages.filter(stage => stage.is_active || (counts[stage.key] ?? 0) > 0)
  for (const [key, total] of Object.entries(counts)) {
    if (total > 0 && !columns.some(stage => stage.key === key)) columns.push(catalog.get(key))
  }
  return columns
}

/** Para condiciones ("la etapa es..."): todas, también las desactivadas (sus
 *  leads siguen ahí), y el valor actual aunque el negocio ya no lo tenga. */
export function conditionStageOptions(catalog: LeadStageCatalog, current?: LeadStage | null): LeadStageDefinition[] {
  const options = [...catalog.stages]
  if (current && !options.some(stage => stage.key === current)) options.push(catalog.get(current))
  return options
}

type Rgb = [number, number, number]

function parseHex(color: string): Rgb | null {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return null
  const value = parseInt(match[1], 16)
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255]
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`
}

/** Mezcla en sRGB: `amount` es cuánto del primer color queda. */
export function mixColors(color: string, other: string, amount: number): string {
  const a = parseHex(color) ?? parseHex(FALLBACK_COLOR)!
  const b = parseHex(other) ?? a
  return toHex([0, 1, 2].map(index => a[index] * amount + b[index] * (1 - amount)) as Rgb)
}

/** Contraste WCAG 2.x entre dos colores hex. */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (color: string) => {
    const [r, g, b] = (parseHex(color) ?? [0, 0, 0]).map(channel => {
      const value = channel / 255
      return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return 0.2126 * r + 0.7152 * g + 0.0722 * b
  }
  const [light, dark] = [luminance(foreground), luminance(background)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}

/** Fondo del panel oscuro (--color-wa-panel-dark) sobre el que se pinta la
 *  insignia en tema oscuro. */
const DARK_SURFACE = '#111b21'

/** Colores derivados de la insignia de una etapa. El texto no es el color
 *  puro (un ámbar sobre blanco no llega a 3:1): se oscurece en claro y se
 *  aclara en oscuro, con un contraste de al menos 4.5:1 para toda la paleta
 *  (ver leadStageMeta.test.ts). */
export function stageBadgeColors(color: string) {
  return {
    lightBackground: mixColors(color, '#ffffff', 0.14),
    lightText: mixColors(color, '#000000', 0.5),
    darkBackground: mixColors(color, DARK_SURFACE, 0.24),
    darkText: mixColors(color, '#ffffff', 0.45),
  }
}

/**
 * Colorear una etapa: el componente fija las variables con `stageColorStyle`
 * y usa estas clases. Los tonos se calculan acá y no con `color-mix()` en CSS
 * porque el respaldo que genera Tailwind para navegadores sin `color-mix`
 * dejaría el texto del mismo color que el fondo.
 */
export function stageColorStyle(color: string): CSSProperties {
  const badge = stageBadgeColors(color)
  return {
    '--stage-color': color,
    '--stage-badge-bg': badge.lightBackground,
    '--stage-badge-fg': badge.lightText,
    '--stage-badge-bg-dark': badge.darkBackground,
    '--stage-badge-fg-dark': badge.darkText,
  } as CSSProperties
}

// El prefijo `color:` le dice a Tailwind que el valor arbitrario es un color
// (sin él, `border-t-[var(...)]` se interpreta como ancho y `text-[...]`
// como tamaño de letra).
export const STAGE_DOT_CLASS = 'bg-[color:var(--stage-color)]'
export const STAGE_ACCENT_CLASS = 'text-[color:var(--stage-color)]'
export const STAGE_HEADER_CLASS = 'border-t-[color:var(--stage-color)]'
export const STAGE_BADGE_CLASS =
  'bg-[color:var(--stage-badge-bg)] text-[color:var(--stage-badge-fg)] dark:bg-[color:var(--stage-badge-bg-dark)] dark:text-[color:var(--stage-badge-fg-dark)]'
