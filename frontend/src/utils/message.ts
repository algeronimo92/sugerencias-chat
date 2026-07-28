import { CornerUpLeft, Mic, Image, Video, MapPin, MousePointerClick, Paperclip, Megaphone, type LucideIcon } from 'lucide-react'

export type MessageKind = 'text' | 'audio' | 'image' | 'video' | 'location' | 'template' | 'other'

const KIND_META: Record<MessageKind, { icon: LucideIcon | null; label: string }> = {
  text: { icon: null, label: '' },
  audio: { icon: Mic, label: 'Audio' },
  image: { icon: Image, label: 'Imagen' },
  video: { icon: Video, label: 'Video' },
  location: { icon: MapPin, label: 'Ubicación' },
  template: { icon: Megaphone, label: 'Plantilla' },
  other: { icon: Paperclip, label: 'Adjunto' },
}

export interface TemplateButton {
  text: string
  /** null en botones que no abren nada (respuestas rápidas, llamadas). */
  url: string | null
}

/** Etiquetas que n8n usa para los mensajes con botones. Comparten el kind
 * 'template' porque se pintan igual, pero cada una tiene su forma de JSON y su
 * propio ícono en los previews. */
const TEMPLATE_TAGS: Record<string, { icon: LucideIcon; label: string }> = {
  // Anuncios y plantillas de empresa (TikTok, Meta): traen preview de enlace.
  templateMessage: { icon: Megaphone, label: 'Plantilla' },
  // Mensajes con botones de respuesta rápida, los que manda el propio negocio.
  buttonsMessage: { icon: MousePointerClick, label: 'Botones' },
  // El cliente tocó uno de esos botones.
  buttonsResponseMessage: { icon: CornerUpLeft, label: 'Respuesta' },
  templateButtonReplyMessage: { icon: CornerUpLeft, label: 'Respuesta' },
}

/** Un mensaje con botones de WhatsApp (un anuncio de plantilla o un mensaje
 * con respuestas rápidas) ya desarmado para pintarlo. */
export interface TemplateMessage {
  /** Título del preview del enlace ("TikTok - Make Your Day"). */
  title: string
  description: string
  domain: string
  body: string
  footer: string
  buttons: TemplateButton[]
  /** Cuando el mensaje es la respuesta del cliente, el texto del mensaje al
   * que le tocó el botón. Vacío en el resto. */
  answeredQuestion: string
}

export interface ParsedContent {
  kind: MessageKind
  icon: LucideIcon | null
  label: string
  text: string
  /** Solo en kind === 'template'; null si el JSON vino roto. */
  template: TemplateMessage | null
}

/** Texto que se muestra cuando la plantilla no trae cuerpo (o no se pudo leer). */
export const TEMPLATE_FALLBACK_TEXT = 'Mensaje de plantilla'

function safeUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null
  // Solo http(s): el JSON viene de afuera y termina en un href.
  return /^https?:\/\//i.test(value) ? value : null
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
}

/** Los campos anidados de WhatsApp vienen como JSON dentro de un string. */
function parseJson(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed = JSON.parse(value)
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/**
 * Lee el JSON crudo que n8n guarda dentro de `<templateMessage>` o
 * `<buttonsMessage>`. Son dos formas distintas del mismo mensaje con botones:
 *
 * - plantilla: `interactiveMessageTemplate`, con el preview del enlace y los
 *   botones en JSON serializado adentro de otro JSON;
 * - botones: `contentText` suelto y los botones con su `displayText`;
 * - respuesta: `selectedDisplayText`, con el mensaje original adentro del
 *   `contextInfo`.
 */
export function parseTemplateMessage(raw: string): TemplateMessage | null {
  const root = parseJson(raw)
  if (!root) return null
  // Según de dónde salga el payload el contenido viene en la raíz o anidado.
  const data = root.interactiveMessageTemplate
    ? asObject(root.interactiveMessageTemplate)
    : root.hydratedTemplate
      ? asObject(root.hydratedTemplate)
      : root

  const header = asObject(data.header)
  const body = asObject(data.body)
  const footer = asObject(data.footer)
  const nativeFlow = asObject(data.nativeFlowMessage)

  const target = asObject(parseJson(nativeFlow.messageParamsJson)?.tap_target_configuration)

  const buttons: TemplateButton[] = []
  for (const button of Array.isArray(nativeFlow.buttons) ? nativeFlow.buttons : []) {
    const params = parseJson(asObject(button).buttonParamsJson)
    if (!params) continue
    const text = asString(params.display_text)
    if (!text) continue
    buttons.push({ text, url: safeUrl(params.url) })
  }
  // Botones de respuesta rápida: no abren nada, los toca el cliente.
  for (const button of Array.isArray(data.buttons) ? data.buttons : []) {
    const text = asString(asObject(asObject(button).buttonText).displayText)
    if (!text) continue
    buttons.push({ text, url: null })
  }

  // Respuesta a un botón: el texto elegido es el mensaje, y el original viene
  // citado adentro del contextInfo (WhatsApp lo muestra arriba de la respuesta).
  const quoted = asObject(asObject(data.contextInfo).quotedMessage)
  const answeredQuestion =
    asString(asObject(quoted.buttonsMessage).contentText) ||
    asString(quoted.conversation) ||
    asString(asObject(quoted.extendedTextMessage).text)

  const parsed: TemplateMessage = {
    title: asString(header.title) || asString(target.title),
    description: asString(target.description),
    domain: asString(target.domain) || asString(target.canonical_url),
    body: asString(body.text) || asString(data.contentText) || asString(data.selectedDisplayText),
    footer: asString(footer.text) || asString(data.footerText),
    buttons,
    answeredQuestion,
  }

  // Si no se reconoció nada útil es que el JSON no era una plantilla.
  if (!parsed.title && !parsed.body && !parsed.buttons.length) return null
  return parsed
}

export function parseContent(content: string | null): ParsedContent {
  if (!content) return { kind: 'text', ...KIND_META.text, text: '', template: null }

  const match = content.match(/^<(\w+)>([\s\S]*)<\/\1>$/)
  if (!match) return { kind: 'text', ...KIND_META.text, text: content.trim(), template: null }

  const [, tag, inner] = match
  const templateMeta = TEMPLATE_TAGS[tag]
  if (templateMeta) {
    const template = parseTemplateMessage(inner)
    return {
      kind: 'template',
      ...templateMeta,
      // Nunca el JSON crudo: este texto es el que sale en la lista de chats,
      // en las citas y en el Kanban.
      text: template?.body || template?.title || TEMPLATE_FALLBACK_TEXT,
      template,
    }
  }

  const kind: MessageKind = tag in KIND_META ? (tag as MessageKind) : 'other'
  return { kind, ...KIND_META[kind], text: inner.trim(), template: null }
}

export interface QuotePreview {
  icon: LucideIcon | null
  /** Tipo del adjunto ("Imagen", "Audio"…); vacío en mensajes de texto. */
  label: string
  /** Texto del mensaje, su epígrafe, o el nombre del archivo adjunto. */
  text: string
}

/** Resumen de una línea de un mensaje citado, como el recuadro de respuesta
 * de WhatsApp: el texto tal cual cuando lo hay, y si no el tipo de adjunto. */
export function quotePreview(content: string | null): QuotePreview {
  const { kind, icon, label, text } = parseContent(content)
  return { icon, label: kind === 'text' ? '' : label, text }
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

/** Un día del hilo con todo lo que pasó ese día, en orden. */
export interface DaySection<T> {
  /** Clave estable de React: la del primer ítem de la sección. */
  key: string
  /** Fecha del día, o null si la sección arranca con ítems sin fecha
   * confirmada (nunca lleva chip). */
  sentAt: string | null
  items: { item: T; globalIndex: number }[]
}

/**
 * Parte una lista cronológica en una sección por día. El chip de fecha se fija
 * arriba con `position: sticky`, que solo empuja al chip anterior si cada uno
 * está acotado por la caja de su propio día — de ahí que haga falta agrupar y
 * no alcance con intercalar separadores en una lista plana.
 *
 * Los ítems sin fecha confirmada (ej. un audio recién enviado, todavía sin
 * `sent_at`) siguen en la sección abierta en vez de cerrarla: si no, el
 * mensaje siguiente abriría una sección espuria con el chip repetido del mismo
 * día. Por eso la comparación es contra el último día CON fecha, no contra el
 * ítem anterior a secas.
 */
export function groupByDay<T extends { key: string; sentAt: string | null }>(
  items: T[],
): DaySection<T>[] {
  const sections: (DaySection<T> & { day: string | null })[] = []
  items.forEach((item, globalIndex) => {
    const day = item.sentAt ? new Date(item.sentAt).toDateString() : null
    const current = sections.at(-1)
    if (!current || (day !== null && day !== current.day)) {
      sections.push({ key: item.key, day, sentAt: item.sentAt, items: [{ item, globalIndex }] })
    } else {
      current.items.push({ item, globalIndex })
    }
  })
  return sections
}

export function resolveMediaUrl(mediaUrl: string | null): string | null {
  if (!mediaUrl) return null
  // Los mensajes optimistas usan data:/blob: locales hasta que el backend
  // devuelve la URL durable. Las URLs absolutas también deben pasar intactas.
  if (/^(?:data:|blob:|https?:\/\/)/i.test(mediaUrl)) return mediaUrl
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
