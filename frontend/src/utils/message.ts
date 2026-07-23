import { Mic, Image, Video, MapPin, Paperclip, type LucideIcon } from 'lucide-react'

export type MessageKind = 'text' | 'audio' | 'image' | 'video' | 'location' | 'other'

const KIND_META: Record<MessageKind, { icon: LucideIcon | null; label: string }> = {
  text: { icon: null, label: '' },
  audio: { icon: Mic, label: 'Audio' },
  image: { icon: Image, label: 'Imagen' },
  video: { icon: Video, label: 'Video' },
  location: { icon: MapPin, label: 'Ubicación' },
  other: { icon: Paperclip, label: 'Adjunto' },
}

export interface ParsedContent {
  kind: MessageKind
  icon: LucideIcon | null
  label: string
  text: string
}

export function parseContent(content: string | null): ParsedContent {
  if (!content) return { kind: 'text', ...KIND_META.text, text: '' }

  const match = content.match(/^<(\w+)>([\s\S]*)<\/\1>$/)
  if (!match) return { kind: 'text', ...KIND_META.text, text: content.trim() }

  const [, tag, inner] = match
  const kind: MessageKind = tag in KIND_META ? (tag as MessageKind) : 'other'
  return { kind, ...KIND_META[kind], text: inner.trim() }
}

function foldText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Recorta el texto para que el término buscado quede visible al inicio del
 * preview (como WhatsApp): si el match está más adelante, se antepone "… "
 * y se arranca un poco antes de la coincidencia. Insensible a acentos. */
export function searchSnippet(text: string, term: string, context = 20): string {
  const needle = foldText(term.trim())
  if (!needle) return text
  const index = foldText(text).indexOf(needle)
  if (index <= context) return text
  return '… ' + text.slice(index - context).trimStart()
}

/** Parte el texto en [antes, match, después] para resaltar la coincidencia,
 * o null si el término no aparece. Insensible a acentos. */
export function splitOnMatch(text: string, term: string): [string, string, string] | null {
  const trimmed = term.trim()
  if (!trimmed) return null
  const index = foldText(text).indexOf(foldText(trimmed))
  if (index < 0) return null
  return [text.slice(0, index), text.slice(index, index + trimmed.length), text.slice(index + trimmed.length)]
}

export function formatMessageTime(sentAt: string | null): string {
  if (!sentAt) return ''
  const d = new Date(sentAt)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export function formatDayLabel(sentAt: string): string {
  const date = new Date(sentAt)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return 'Hoy'
  if (date.toDateString() === yesterday.toDateString()) return 'Ayer'
  return date.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'long',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  })
}

export function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  return `${base}${mediaUrl}`
}

export type RichSegmentType = 'text' | 'link' | 'bold' | 'italic' | 'strike' | 'code'

export interface RichSegment {
  type: RichSegmentType
  text: string
}

const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

// Orden de prioridad: URL, bloque de código, código inline, negrita markdown
// (**x**, común en texto generado por IA), negrita/cursiva/tachado estilo
// WhatsApp (*x*, _x_, ~x~).
const RICH_TEXT_REGEX =
  /(https?:\/\/[^\s]+)|```([^`]+?)```|`([^`\n]+?)`|\*\*([^\n*]+?)\*\*|\*([^\n*]+?)\*|_([^\n_]+?)_|~([^\n~]+?)~/g

/**
 * Interpreta el mismo formato que usa WhatsApp (*negrita*, _cursiva_,
 * ~tachado~, `código`), más **negrita** estilo markdown, y los links, para
 * renderizarlos como texto con estilo en vez de mostrar los símbolos
 * literales. No soporta formato anidado (ej. un link dentro de una negrita),
 * igual que WhatsApp.
 */
export function parseRichText(text: string): RichSegment[] {
  const segments: RichSegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(RICH_TEXT_REGEX)) {
    const start = match.index ?? 0
    const [full, url, codeBlock, code, boldDouble, boldSingle, italic, strike] = match

    if (url !== undefined) {
      let trimmedUrl = url
      let trailing = ''
      const punctuation = trimmedUrl.match(TRAILING_PUNCTUATION)
      if (punctuation) {
        trailing = punctuation[0]
        trimmedUrl = trimmedUrl.slice(0, -trailing.length)
      }
      if (!trimmedUrl) continue

      if (start > lastIndex) segments.push({ type: 'text', text: text.slice(lastIndex, start) })
      segments.push({ type: 'link', text: trimmedUrl })
      if (trailing) segments.push({ type: 'text', text: trailing })
      lastIndex = start + full.length
      continue
    }

    let type: RichSegmentType
    let content: string
    if (codeBlock !== undefined) {
      type = 'code'
      content = codeBlock
    } else if (code !== undefined) {
      type = 'code'
      content = code
    } else if (boldDouble !== undefined) {
      type = 'bold'
      content = boldDouble
    } else if (boldSingle !== undefined) {
      type = 'bold'
      content = boldSingle
    } else if (italic !== undefined) {
      type = 'italic'
      content = italic
    } else if (strike !== undefined) {
      type = 'strike'
      content = strike
    } else {
      continue
    }

    if (start > lastIndex) segments.push({ type: 'text', text: text.slice(lastIndex, start) })
    segments.push({ type, text: content })
    lastIndex = start + full.length
  }

  if (lastIndex < text.length) {
    segments.push({ type: 'text', text: text.slice(lastIndex) })
  }

  return segments.length ? segments : [{ type: 'text', text }]
}
