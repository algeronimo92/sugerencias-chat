import {
  BarChart3, CornerUpLeft, Image, List, MapPin, Megaphone, Mic, MousePointerClick,
  CreditCard, Paperclip, ReceiptText, ShoppingBag, SmilePlus, Sticker, User,
  Video, FileText, type LucideIcon,
} from 'lucide-react'
import type { JsonObject, JsonValue, MessageType, MessageAnalysis } from '../types'

/** Clase de render de un mensaje: coincide con la taxonomía del backend
 * (MessageType). El frontend elige ícono/burbuja por acá. */
export type MessageKind = MessageType

const KIND_META: Record<MessageKind, { icon: LucideIcon | null; label: string }> = {
  text: { icon: null, label: '' },
  image: { icon: Image, label: 'Imagen' },
  video: { icon: Video, label: 'Video' },
  ptv: { icon: Video, label: 'Video' },
  audio: { icon: Mic, label: 'Audio' },
  document: { icon: FileText, label: 'Documento' },
  location: { icon: MapPin, label: 'Ubicación' },
  sticker: { icon: Sticker, label: 'Sticker' },
  contact: { icon: User, label: 'Contacto' },
  poll: { icon: BarChart3, label: 'Encuesta' },
  reaction: { icon: SmilePlus, label: 'Reacción' },
  interactive: { icon: List, label: 'Interactivo' },
  template: { icon: Megaphone, label: 'Plantilla' },
  order: { icon: ReceiptText, label: 'Pedido' },
  product: { icon: ShoppingBag, label: 'Producto' },
  payment: { icon: CreditCard, label: 'Pago' },
  unsupported: { icon: Paperclip, label: 'No soportado' },
}

export interface TemplateButton {
  text: string
  /** null en botones que no abren nada (respuestas rápidas, llamadas). */
  url: string | null
}

/** Etiquetas legadas que n8n usaba para los mensajes con botones. Comparten el
 * kind 'template' porque se pintan igual, pero cada una tiene su forma de JSON
 * y su propio ícono en los previews. */
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

/** Pseudo-tags simples que escribía n8n en `content` antes de la normalización.
 * Solo respaldo para filas legadas sin backfillear; los tags de plantilla van
 * aparte (TEMPLATE_TAGS) porque llevan JSON adentro. */
const LEGACY_TAG_KIND: Record<string, MessageKind> = {
  text: 'text',
  image: 'image',
  video: 'video',
  audio: 'audio',
  location: 'location',
  other: 'document',
}

/** Entrada de `parseContent`: el objeto mensaje (camino nuevo, por
 * `message_type`) o solo su `content` string (previews que aún no llevan el
 * tipo, y respaldo legado). */
export interface ParsableMessage {
  content: string | null
  message_type?: MessageType | null
  analysis?: MessageAnalysis | null
  payload?: JsonObject | null
}
type ParseInput = string | null | ParsableMessage

export interface ParsedContent {
  kind: MessageKind
  icon: LucideIcon | null
  label: string
  /** Texto humano del mensaje (caption/cuerpo), sin el análisis IA ni JSON. */
  text: string
  /** Resumen del análisis generado con IA, para mostrar bajo demanda. null si
   * el mensaje no tiene análisis. */
  analysis: string | null
  /** Datos estructurados del tipo (lat/lon, filename, opciones…). */
  payload: JsonObject | null
  /** Solo en template/interactive; null si el JSON vino roto o no aplica. */
  template: TemplateMessage | null
}

/** Texto que se muestra cuando la plantilla no trae cuerpo (o no se pudo leer). */
export const TEMPLATE_FALLBACK_TEXT = 'Mensaje de plantilla'

function safeUrl(value: JsonValue | undefined): string | null {
  if (typeof value !== 'string' || !value) return null
  // Solo http(s): el JSON viene de afuera y termina en un href.
  return /^https?:\/\//i.test(value) ? value : null
}

function asString(value: JsonValue | undefined): string {
  return typeof value === 'string' ? value.trim() : ''
}

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function asObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {}
}

/** Los campos anidados de WhatsApp vienen como JSON dentro de un string. */
function parseJson(value: JsonValue | undefined): JsonObject | null {
  if (typeof value !== 'string' || !value.trim()) return null
  try {
    const parsed: JsonValue = JSON.parse(value)
    return isJsonObject(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * Desarma el objeto de un mensaje con botones. Son formas distintas del mismo
 * mensaje:
 *
 * - plantilla: `interactiveMessageTemplate`, con el preview del enlace y los
 *   botones en JSON serializado adentro de otro JSON;
 * - botones: `contentText` suelto y los botones con su `displayText`;
 * - respuesta: `selectedDisplayText`, con el mensaje original adentro del
 *   `contextInfo`.
 *
 * Recibe el objeto ya parseado: sirve tanto para el JSON crudo embebido en los
 * tags legados como para la columna `payload` del modelo normalizado.
 */
export function parseTemplateData(root: JsonObject | null): TemplateMessage | null {
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
    const buttonData = asObject(button)
    const text = asString(asObject(buttonData.buttonText).displayText) || asString(buttonData.text)
    if (!text) continue
    buttons.push({ text, url: safeUrl(buttonData.url) })
  }
  for (const option of Array.isArray(data.options) ? data.options : []) {
    const optionData = asObject(option)
    const text = asString(optionData.text) || asString(optionData.title)
    if (text) buttons.push({ text, url: null })
  }

  // Respuesta a un botón: el texto elegido es el mensaje, y el original viene
  // citado adentro del contextInfo (WhatsApp lo muestra arriba de la respuesta).
  const quoted = asObject(asObject(data.contextInfo).quotedMessage)
  const answeredQuestion =
    asString(asObject(quoted.buttonsMessage).contentText) ||
    asString(quoted.conversation) ||
    asString(asObject(quoted.extendedTextMessage).text)

  const parsed: TemplateMessage = {
    title: asString(header.title) || asString(target.title) || asString(data.title),
    description: asString(target.description),
    domain: asString(target.domain) || asString(target.canonical_url),
    body: asString(body.text) || asString(data.body) || asString(data.contentText) ||
      asString(data.selectedDisplayText) || asString(data.selected_text) || asString(data.description),
    footer: asString(footer.text) || asString(data.footer) || asString(data.footerText),
    buttons,
    answeredQuestion,
  }

  // Si no se reconoció nada útil es que el JSON no era una plantilla.
  if (!parsed.title && !parsed.body && !parsed.buttons.length) return null
  return parsed
}

/** Variante para el JSON crudo que n8n guardaba dentro de los tags legados. */
export function parseTemplateMessage(raw: string): TemplateMessage | null {
  return parseTemplateData(parseJson(raw))
}

export function parseContent(input: ParseInput): ParsedContent {
  const obj: ParsableMessage | null =
    typeof input === 'string' || input == null ? null : input
  // Cuando `obj` es null el input ya es string | null (por la condición de
  // arriba); el cast solo se lo confirma a TypeScript.
  const content: string | null = obj ? obj.content : (input as string | null)

  // Camino nuevo: el backend ya clasificó el mensaje y separó el análisis.
  if (obj && obj.message_type) {
    const kind: MessageKind = obj.message_type in KIND_META ? obj.message_type : 'unsupported'
    const payload = obj.payload ?? null
    const template =
      kind === 'template' || kind === 'interactive' ? parseTemplateData(payload) : null
    const text =
      (content ?? '').trim() ||
      (template ? template.body || template.title : '') ||
      (kind === 'template' ? TEMPLATE_FALLBACK_TEXT : '')
    return {
      kind,
      ...KIND_META[kind],
      text,
      analysis: obj.analysis?.summary?.trim() || null,
      payload,
      template,
    }
  }

  // Camino legado: clasificar por los pseudo-tags embebidos en `content`.
  return parseLegacyContent(content, obj?.analysis?.summary ?? null, obj?.payload ?? null)
}

function parseLegacyContent(
  content: string | null,
  analysisFromColumn: string | null,
  payload: JsonObject | null,
): ParsedContent {
  if (!content) {
    return { kind: 'text', ...KIND_META.text, text: '', analysis: analysisFromColumn, payload, template: null }
  }

  const match = content.match(/^<(\w+)>([\s\S]*)<\/\1>$/)
  if (!match) {
    return { kind: 'text', ...KIND_META.text, text: content.trim(), analysis: analysisFromColumn, payload, template: null }
  }

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
      analysis: analysisFromColumn,
      payload,
      template,
    }
  }

  const kind: MessageKind = LEGACY_TAG_KIND[tag] ?? 'unsupported'
  const { text, analysis } = splitLegacyInner(kind, inner)
  return { kind, ...KIND_META[kind], text, analysis: analysisFromColumn ?? analysis, payload, template: null }
}

/** Separa el caption del bloque `Analisis:` que n8n embebía dentro de los tags
 * de imagen/video, y trata el interior de `<audio>` como transcripción. Así el
 * análisis no se muestra dentro de la burbuja ni siquiera en filas legadas. */
function splitLegacyInner(kind: MessageKind, inner: string): { text: string; analysis: string | null } {
  const trimmed = inner.trim()
  if (kind === 'audio') return { text: '', analysis: trimmed || null }
  if (kind === 'image' || kind === 'video') {
    // El bloque va tras el caption o directamente al principio si no hay caption.
    const match = trimmed.match(/(^|\n)\s*Analisis:\s*/i)
    if (match) {
      const marker = match.index ?? 0
      const rest = trimmed.slice(marker + match[0].length)
      return { text: trimmed.slice(0, marker).trim(), analysis: rest.trim() || null }
    }
  }
  return { text: trimmed, analysis: null }
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
export function quotePreview(input: ParseInput): QuotePreview {
  const { kind, icon, label, text } = parseContent(input)
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

/** Anuncio del que vino el lead (Click-to-WhatsApp de Meta): el primer mensaje
 * trae este contexto en `payload.ad_referral`. */
export interface AdReferral {
  title: string
  body: string
  sourceUrl: string | null
  thumbnailUrl: string | null
  ctwaClid: string | null
}

/** Lee el anuncio (Click-to-WhatsApp) del payload de un mensaje, o null si el
 * mensaje no vino de un anuncio. */
export function messageAdReferral(payload: JsonObject | null): AdReferral | null {
  const ad = payload?.ad_referral
  if (!isJsonObject(ad)) return null
  const title = asString(ad.title)
  const body = asString(ad.body)
  if (!title && !body) return null
  const thumb = asString(ad.thumbnail_url)
  return {
    title,
    body,
    sourceUrl: safeUrl(ad.source_url),
    thumbnailUrl: thumb.startsWith('/media/') || safeUrl(thumb) ? resolveMediaUrl(thumb) : null,
    ctwaClid: asString(ad.ctwa_clid) || null,
  }
}

/** Coordenadas de un mensaje de ubicación: de `payload` (modelo nuevo) o del
 * "lat,lon" que vivía en content (respaldo legado). null si no hay. */
export function messageCoords(
  payload: JsonObject | null,
  legacyText: string,
): [number, number] | null {
  const lat = Number(payload?.latitude)
  const lon = Number(payload?.longitude)
  if (Number.isFinite(lat) && Number.isFinite(lon)) return [lat, lon]
  const [legacyLat, legacyLon] = legacyText.split(',').map(Number)
  if (Number.isFinite(legacyLat) && Number.isFinite(legacyLon)) return [legacyLat, legacyLon]
  return null
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
