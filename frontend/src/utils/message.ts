export type MessageKind = 'text' | 'audio' | 'image' | 'video' | 'other'

const KIND_META: Record<MessageKind, { icon: string; label: string }> = {
  text: { icon: '', label: '' },
  audio: { icon: '🎤', label: 'Audio' },
  image: { icon: '🖼️', label: 'Imagen' },
  video: { icon: '🎥', label: 'Video' },
  other: { icon: '📎', label: 'Adjunto' },
}

export interface ParsedContent {
  kind: MessageKind
  icon: string
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
