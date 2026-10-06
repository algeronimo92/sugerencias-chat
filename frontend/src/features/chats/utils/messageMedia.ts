import type { Message } from '../types'
import { messageFilename, parseContent } from './message'

const DEFAULT_MEDIA_EXTENSIONS: Record<string, string> = {
  image: 'jpg',
  video: 'mp4',
  audio: 'ogg',
  sticker: 'webp',
  document: 'bin',
}

function safeDownloadName(value: string): string {
  const basename = value.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = Array.from(basename, character => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || character === '"' ? '_' : character
  }).join('').trim()
  return cleaned || 'archivo'
}

function extensionFromUrl(mediaUrl: string | null): string | null {
  const pathname = (mediaUrl ?? '').split(/[?#]/, 1)[0]
  const match = pathname.match(/\.([a-z0-9]{1,8})$/i)
  return match?.[1].toLowerCase() ?? null
}

/** Nombre humano y estable para un adjunto de WhatsApp. Conserva el original
 * cuando existe; para notas de voz/fotos entrantes usa fecha y extensión. */
export function messageMediaFilename(message: Message): string {
  const parsed = parseContent(message)
  const original = messageFilename(parsed)
  const kind = parsed.kind
  const extension = extensionFromUrl(message.media_url) ?? DEFAULT_MEDIA_EXTENSIONS[kind] ?? 'bin'
  if (original) {
    const safeOriginal = safeDownloadName(original)
    return /\.[a-z0-9]{1,8}$/i.test(safeOriginal) ? safeOriginal : `${safeOriginal}.${extension}`
  }

  const stamp = (message.sent_at ?? '').slice(0, 16).replace('T', '_').replace(/:/g, '-')
  const prefix = kind === 'document' ? 'documento' : kind === 'sticker' ? 'sticker' : kind
  return `${prefix || 'archivo'}${stamp ? `-${stamp}` : ''}.${extension}`
}
