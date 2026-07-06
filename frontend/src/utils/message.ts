import { Mic, Image, Video, Paperclip, type LucideIcon } from 'lucide-react'

export type MessageKind = 'text' | 'audio' | 'image' | 'video' | 'other'

const KIND_META: Record<MessageKind, { icon: LucideIcon | null; label: string }> = {
  text: { icon: null, label: '' },
  audio: { icon: Mic, label: 'Audio' },
  image: { icon: Image, label: 'Imagen' },
  video: { icon: Video, label: 'Video' },
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

export function formatMessageTime(sentAt: string | null): string {
  if (!sentAt) return ''
  const d = new Date(sentAt)
  return d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })
}

export function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  return `${base}${mediaUrl}`
}

export interface TextSegment {
  text: string
  isLink: boolean
}

const URL_REGEX = /https?:\/\/[^\s]+/g
const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/

/** Separa un texto en segmentos planos y de link, para poder renderizar los links como <a> cliqueables. */
export function splitLinks(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let lastIndex = 0

  for (const match of text.matchAll(URL_REGEX)) {
    const start = match.index ?? 0
    let url = match[0]
    let trailing = ''

    const punctuation = url.match(TRAILING_PUNCTUATION)
    if (punctuation) {
      trailing = punctuation[0]
      url = url.slice(0, -trailing.length)
    }
    if (!url) continue

    if (start > lastIndex) {
      segments.push({ text: text.slice(lastIndex, start), isLink: false })
    }
    segments.push({ text: url, isLink: true })
    if (trailing) {
      segments.push({ text: trailing, isLink: false })
    }
    lastIndex = start + match[0].length
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), isLink: false })
  }

  return segments.length ? segments : [{ text, isLink: false }]
}
