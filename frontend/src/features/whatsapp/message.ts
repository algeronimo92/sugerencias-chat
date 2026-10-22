import {
AlertTriangle,
CornerUpLeft,
FileText,
Image,
Info,
LayoutGrid,
List,
MapPin,
Megaphone,
Mic,
MousePointerClick,
Paperclip,
PhoneCall,
ReceiptText,
ShoppingBag,
SmilePlus,
Sticker,
User,
Video,
Workflow,
type LucideIcon,
} from "lucide-react";
import type { JsonObject, JsonValue } from '../../shared/types';
import { isJsonObject } from '../../shared/utils/json';
import { META_CONTRACT } from "./domain/metaContract";
import type { MessageAnalysis, MessageType } from './types'

/** Tipo literal de Meta (`messages[].type`). Un tipo que el contrato todavía
 * no conoce llega igual, con su nombre, y se muestra con un renderer genérico. */
export type MessageKind = MessageType;

interface KindMeta {
  icon: LucideIcon | null;
  label: string;
}

/** Ícono y rótulo de cada raíz de Meta. Las que no están acá caen a
 * `unknownKindMeta`, que nombra el tipo literal en vez de ocultarlo. */
const KIND_META: Record<string, KindMeta> = {
  text: { icon: null, label: "" },
  image: { icon: Image, label: "Imagen" },
  video: { icon: Video, label: "Video" },
  audio: { icon: Mic, label: "Audio" },
  document: { icon: FileText, label: "Documento" },
  sticker: { icon: Sticker, label: "Sticker" },
  location: { icon: MapPin, label: "Ubicación" },
  contacts: { icon: User, label: "Contacto" },
  reaction: { icon: SmilePlus, label: "Reacción" },
  interactive: { icon: List, label: "Interactivo" },
  button: { icon: CornerUpLeft, label: "Respuesta" },
  order: { icon: ReceiptText, label: "Pedido" },
  system: { icon: Info, label: "Aviso de WhatsApp" },
  template: { icon: Megaphone, label: "Plantilla" },
  unknown: { icon: AlertTriangle, label: "No soportado por WhatsApp" },
  unsupported: { icon: AlertTriangle, label: "No soportado por WhatsApp" },
};

/** Rótulo de cada subtipo interactivo, de entrada y de salida. */
const INTERACTIVE_META: Record<string, KindMeta> = {
  button_reply: { icon: CornerUpLeft, label: "Respuesta" },
  list_reply: { icon: CornerUpLeft, label: "Selección" },
  nfm_reply: { icon: Workflow, label: "Formulario" },
  button: { icon: MousePointerClick, label: "Botones" },
  list: { icon: List, label: "Lista" },
  product: { icon: ShoppingBag, label: "Producto" },
  product_list: { icon: ShoppingBag, label: "Productos" },
  catalog_message: { icon: LayoutGrid, label: "Catálogo" },
  flow: { icon: Workflow, label: "Formulario" },
  call_permission_request: { icon: PhoneCall, label: "Permiso de llamada" },
};

function unknownKindMeta(kind: string, subtype: string | null): KindMeta {
  const literal = subtype ? `${kind}/${subtype}` : kind;
  return { icon: Paperclip, label: `Mensaje ${literal}` };
}

const KNOWN_ROOTS = new Set<string>([
  ...META_CONTRACT.inbound.root_types,
  ...META_CONTRACT.outbound.root_types,
]);
const KNOWN_INTERACTIVE = new Set<string>([
  ...META_CONTRACT.inbound.subtypes.interactive,
  ...META_CONTRACT.outbound.subtypes.interactive,
]);

/** Si la UI tiene un renderer propio para esta combinación. */
export function isKnownMessageType(kind: string, subtype: string | null): boolean {
  if (!KNOWN_ROOTS.has(kind)) return false;
  if (kind === "interactive") return subtype == null || KNOWN_INTERACTIVE.has(subtype);
  return true;
}

function kindMeta(kind: string, subtype: string | null): KindMeta {
  if (!isKnownMessageType(kind, subtype)) return unknownKindMeta(kind, subtype);
  if (kind === "interactive" && subtype) return INTERACTIVE_META[subtype];
  return KIND_META[kind];
}

export interface TemplateButton {
  text: string;
  /** null en botones que no abren nada (respuestas rápidas, llamadas). */
  url: string | null;
}

/** Mensaje con encabezado, cuerpo, pie y botones ya desarmado para pintarlo:
 * una plantilla oficial enviada o un interactivo de botones o lista. */
export interface TemplateMessage {
  title: string;
  body: string;
  footer: string;
  buttons: TemplateButton[];
  /** Encabezado de imagen de una plantilla oficial. */
  headerImageUrl: string | null;
}

/** Entrada de `parseContent`: el objeto mensaje o solo su `content` (previews
 * que no traen más que el texto). */
export interface ParsableMessage {
  content: string | null;
  message_type?: MessageType | null;
  message_subtype?: string | null;
  analysis?: MessageAnalysis | null;
  payload?: JsonObject | null;
  provider_payload?: JsonObject | null;
}
type ParseInput = string | null | ParsableMessage;

export interface ParsedContent {
  kind: MessageKind;
  subtype: string | null;
  /** Si hay un renderer propio: un tipo nuevo de Meta se muestra genérico. */
  known: boolean;
  icon: LucideIcon | null;
  label: string;
  /** Texto humano del mensaje (caption/cuerpo), sin el análisis IA ni JSON. */
  text: string;
  /** Resumen del análisis generado con IA, para mostrar bajo demanda. */
  analysis: string | null;
  /** Objeto de Meta del mensaje (`provider_payload`), o la proyección que
   * guardó el CRM para filas anteriores al contrato. Se lee por raíz:
   * `meta.location`, `meta.contacts`, `meta.interactive`... */
  meta: JsonObject;
  /** Proyección del CRM: datos de plantilla, reenviado, anuncio, álbum. */
  payload: JsonObject | null;
  /** Plantilla enviada o interactivo de botones/lista, ya desarmado. */
  template: TemplateMessage | null;
}

/** Texto que se muestra cuando la plantilla no trae cuerpo. */
export const TEMPLATE_FALLBACK_TEXT = "Mensaje de plantilla";

function safeUrl(value: JsonValue | undefined): string | null {
  if (typeof value !== "string" || !value) return null;
  // Solo http(s): el JSON viene de afuera y termina en un href.
  return /^https?:\/\//i.test(value) ? value : null;
}

function asString(value: JsonValue | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

export { isJsonObject };

function asObject(value: JsonValue | undefined): JsonObject {
  return isJsonObject(value) ? value : {};
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function asNumber(value: JsonValue | undefined): number | null {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim()))
    return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Botones y lista de un `interactive` de Meta (el que manda el negocio). */
function interactiveTemplate(interactive: JsonObject): TemplateMessage | null {
  const subtype = asString(interactive.type);
  const action = asObject(interactive.action);
  let buttons: TemplateButton[] = [];
  if (subtype === "button") {
    buttons = asArray(action.buttons).flatMap((button) => {
      const title = asString(asObject(asObject(button).reply).title);
      return title ? [{ text: title, url: null }] : [];
    });
  } else if (subtype === "list") {
    // WhatsApp solo muestra, en el mensaje, el botón que abre la lista.
    buttons = [{ text: asString(action.button) || "Ver opciones", url: null }];
  } else if (subtype === "flow") {
    const cta = asString(asObject(action.parameters).flow_cta);
    buttons = cta ? [{ text: cta, url: null }] : [];
  } else if (subtype === "catalog_message") {
    buttons = [{ text: "Ver catálogo", url: null }];
  } else if (subtype === "call_permission_request") {
    buttons = [{ text: "Permitir llamadas", url: null }];
  }
  const header = asObject(interactive.header);
  const title = asString(header.type) === "text" ? asString(header.text) : "";
  const body = asString(asObject(interactive.body).text);
  const footer = asString(asObject(interactive.footer).text);
  if (!title && !body && !footer && !buttons.length) return null;
  return { title, body, footer, buttons, headerImageUrl: null };
}

/** Lo que el CRM guardó para pintar una plantilla oficial enviada: Meta la
 * conoce por nombre y el cuerpo enviado no trae encabezado, pie ni botones. */
function officialTemplate(payload: JsonObject | null): TemplateMessage | null {
  const display = asObject(payload?.template);
  if (!Object.keys(display).length) return null;
  const buttons = asArray(display.buttons).flatMap((button) => {
    const data = asObject(button);
    const text = asString(data.text);
    if (!text) return [];
    return [{ text, url: asString(data.type) === "url" ? safeUrl(data.url) : null }];
  });
  // Puede ser una ruta propia (`/api/media/...`): la resuelve quien la pinta.
  const headerImageUrl = asString(display.header_image_url) || null;
  return {
    title: asString(display.header_text),
    body: "",
    footer: asString(display.footer),
    buttons,
    headerImageUrl,
  };
}

function metaObject(input: ParsableMessage): JsonObject {
  return input.provider_payload ?? input.payload ?? {};
}

export function parseContent(input: ParseInput): ParsedContent {
  const message: ParsableMessage =
    typeof input === "string" || input == null ? { content: input ?? null } : input;
  const kind: MessageKind = message.message_type || "text";
  const subtype = message.message_subtype ?? null;
  const meta = metaObject(message);
  const payload = message.payload ?? null;
  const known = isKnownMessageType(kind, subtype);
  const rawText = (message.content ?? "").trim();

  let template: TemplateMessage | null = null;
  let text = rawText;
  if (kind === "template") {
    template = officialTemplate(payload);
    text = rawText || TEMPLATE_FALLBACK_TEXT;
  } else if (kind === "interactive") {
    const interactive = asObject(meta.interactive);
    template = interactiveTemplate(interactive);
    text = rawText || template?.body || template?.title || "";
  } else if (kind === "button") {
    text = rawText || asString(asObject(meta.button).text);
  } else if (kind === "system") {
    text = rawText || asString(asObject(meta.system).body);
  }

  return {
    kind,
    subtype,
    known,
    ...kindMeta(kind, subtype),
    text,
    analysis: message.analysis?.summary?.trim() || null,
    meta,
    payload,
    template,
  };
}

/** Anuncio del que vino el lead (Click-to-WhatsApp): el `referral` literal
 * de Meta, con la imagen rehospedada por el backend si la hay. */
export interface AdReferral {
  title: string;
  body: string;
  sourceUrl: string | null;
  thumbnailUrl: string | null;
  ctwaClid: string | null;
}

export function messageAdReferral(parsed: Pick<ParsedContent, "meta" | "payload">): AdReferral | null {
  const referral = asObject(parsed.meta.referral);
  const title = asString(referral.headline);
  const body = asString(referral.body);
  if (!title && !body && !asString(referral.source_url)) return null;
  const rehosted = asString(parsed.payload?.referral_thumbnail_url);
  const thumbnail = rehosted || asString(referral.thumbnail_url) || asString(referral.image_url);
  return {
    title,
    body,
    sourceUrl: safeUrl(referral.source_url),
    thumbnailUrl:
      thumbnail.startsWith("/media/") || safeUrl(thumbnail)
        ? resolveMediaUrl(thumbnail)
        : null,
    ctwaClid: asString(referral.ctwa_clid) || null,
  };
}

/** Un contacto compartido, ya desarmado para pintarlo y para poder abrirle
 * (o crearle) su lead. */
export interface SharedContact {
  name: string;
  /** Solo dígitos: con esto se busca o se crea el lead. null si no trae
   * ningún número usable. */
  phone: string[] | null;
  /** El número tal como lo mandó el remitente, para mostrarlo tal cual. */
  phoneLabel: string;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

/** Contactos de un mensaje `contacts` de Meta (`name`/`phones`). `wa_id` gana
 * sobre el número visible: es el que WhatsApp puede abrir. */
export function messageContacts(meta: JsonObject): SharedContact[] {
  return asArray(meta.contacts).filter(isJsonObject).map((contact) => {
    const name = asObject(contact.name);
    const phones = asArray(contact.phones)
      .filter(isJsonObject)
      .map((phone) => ({
        digits: onlyDigits(asString(phone.wa_id) || asString(phone.phone)),
        label: asString(phone.phone),
      }))
      .filter((phone) => phone.digits);
    return {
      name: asString(name.formatted_name) || asString(name.first_name) || "Contacto compartido",
      phone: phones.length ? phones.map((phone) => phone.digits) : null,
      phoneLabel: phones[0]?.label ?? "",
    };
  });
}

/** Nombre original del adjunto: el `filename` del objeto de Meta
 * (`document.filename`), o el que guardó el CRM al enviarlo. */
export function messageFilename(parsed: Pick<ParsedContent, "kind" | "meta" | "payload">): string {
  return asString(asObject(parsed.meta[parsed.kind]).filename) || asString(parsed.payload?.filename);
}

/** Coordenadas de un mensaje `location` de Meta. */
export function messageCoords(meta: JsonObject): [number, number] | null {
  const location = asObject(meta.location);
  const lat = asNumber(location.latitude);
  const lon = asNumber(location.longitude);
  return lat != null && lon != null ? [lat, lon] : null;
}

export interface MetaOrderItem {
  sku: string;
  quantity: number | null;
  price: number | null;
  currency: string;
}

/** Pedido de un catálogo (`order`), con los valores literales de Meta. */
export interface MetaOrder {
  catalogId: string;
  text: string;
  items: MetaOrderItem[];
  /** Total por moneda: un pedido puede mezclar monedas y no se convierten. */
  totals: { currency: string; amount: number }[];
}

export function messageOrder(meta: JsonObject): MetaOrder {
  const order = asObject(meta.order);
  const items = asArray(order.product_items).filter(isJsonObject).map((item) => ({
    sku: asString(item.product_retailer_id),
    quantity: asNumber(item.quantity),
    price: asNumber(item.item_price),
    currency: asString(item.currency),
  }));
  const totals = new Map<string, number>();
  for (const item of items) {
    if (item.price == null || item.quantity == null) continue;
    totals.set(item.currency, (totals.get(item.currency) ?? 0) + item.price * item.quantity);
  }
  return {
    catalogId: asString(order.catalog_id),
    text: asString(order.text),
    items,
    totals: [...totals].map(([currency, amount]) => ({ currency, amount })),
  };
}

export function formatMoney(amount: number, currency: string): string {
  const value = amount.toLocaleString("es-PE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return currency ? `${currency} ${value}` : value;
}

/** Respuesta a un botón o a una lista (`interactive.button_reply`/`list_reply`)
 * o a un botón de plantilla (`button`): lo que tocó y el id o payload literal. */
export interface ReplySelection {
  title: string;
  id: string;
  description: string;
}

export function messageReply(parsed: Pick<ParsedContent, "kind" | "subtype" | "meta">): ReplySelection | null {
  if (parsed.kind === "button") {
    const button = asObject(parsed.meta.button);
    return { title: asString(button.text), id: asString(button.payload), description: "" };
  }
  if (parsed.kind !== "interactive" || (parsed.subtype !== "button_reply" && parsed.subtype !== "list_reply")) {
    return null;
  }
  const reply = asObject(asObject(parsed.meta.interactive)[parsed.subtype]);
  return {
    title: asString(reply.title),
    id: asString(reply.id),
    description: asString(reply.description),
  };
}

/** Respuesta a un WhatsApp Flow (`interactive.nfm_reply`): el `response_json`
 * se muestra campo por campo; `flow_token` es interno y no se lista. */
export interface FlowReply {
  name: string;
  body: string;
  fields: { key: string; value: string }[];
}

export function messageFlowReply(meta: JsonObject): FlowReply {
  const reply = asObject(asObject(meta.interactive).nfm_reply);
  let data: JsonValue = null;
  const raw = reply.response_json;
  if (typeof raw === "string") {
    try {
      data = JSON.parse(raw);
    } catch {
      data = raw;
    }
  } else if (raw !== undefined) {
    data = raw;
  }
  const fields = isJsonObject(data)
    ? Object.entries(data)
        .filter(([key]) => key !== "flow_token")
        .map(([key, value]) => ({
          key,
          value: typeof value === "string" ? value : JSON.stringify(value),
        }))
    : data != null
      ? [{ key: "respuesta", value: typeof data === "string" ? data : JSON.stringify(data) }]
      : [];
  return { name: asString(reply.name), body: asString(reply.body), fields };
}

/** Producto del catálogo que se mandó o por el que preguntó el cliente. */
export interface ProductReference {
  catalogId: string;
  sku: string;
}

export function messageProducts(parsed: Pick<ParsedContent, "kind" | "subtype" | "meta">): ProductReference[] {
  const referred = asObject(asObject(parsed.meta.context).referred_product);
  if (Object.keys(referred).length) {
    return [{ catalogId: asString(referred.catalog_id), sku: asString(referred.product_retailer_id) }];
  }
  if (parsed.kind !== "interactive") return [];
  const action = asObject(asObject(parsed.meta.interactive).action);
  const catalogId = asString(action.catalog_id);
  if (parsed.subtype === "product") {
    return [{ catalogId, sku: asString(action.product_retailer_id) }];
  }
  if (parsed.subtype === "product_list") {
    return asArray(action.sections).flatMap((section) =>
      asArray(asObject(section).product_items).map((item) => ({
        catalogId,
        sku: asString(asObject(item).product_retailer_id),
      })),
    );
  }
  if (parsed.subtype === "catalog_message") {
    const thumbnail = asString(asObject(action.parameters).thumbnail_product_retailer_id);
    return thumbnail ? [{ catalogId, sku: thumbnail }] : [];
  }
  return [];
}

/** Aviso de sistema de Meta (`system`), por ejemplo un cambio de número. */
export function messageSystemNotice(meta: JsonObject): { body: string; type: string } {
  const system = asObject(meta.system);
  return { body: asString(system.body), type: asString(system.type) };
}

/** Errores que Meta informó para el mensaje o para su entrega. */
export interface MetaError {
  code: string;
  title: string;
  details: string;
}

export function metaErrors(source: JsonObject | null | undefined): MetaError[] {
  return asArray(source?.errors).filter(isJsonObject).map((error) => ({
    code: error.code == null ? "" : String(error.code),
    title: asString(error.title) || asString(error.message),
    details: asString(asObject(error.error_data).details) || asString(error.details),
  }));
}

export interface QuotePreview {
  icon: LucideIcon | null;
  /** Tipo del adjunto ("Imagen", "Audio"…); vacío en mensajes de texto. */
  label: string;
  /** Texto del mensaje, su epígrafe, o el nombre del archivo adjunto. */
  text: string;
}

/** Resumen de una línea de un mensaje citado, como el recuadro de respuesta
 * de WhatsApp: el texto tal cual cuando lo hay, y si no el tipo de adjunto. */
export function quotePreview(input: ParseInput): QuotePreview {
  const { kind, icon, label, text } = parseContent(input);
  return { icon, label: kind === "text" ? "" : label, text };
}

function foldText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Recorta el texto para que el término buscado quede visible al inicio del
 * preview (como WhatsApp): si el match está más adelante, se antepone "… "
 * y se arranca un poco antes de la coincidencia. Insensible a acentos. */
export function searchSnippet(
  text: string,
  term: string,
  context = 20,
): string {
  const needle = foldText(term.trim());
  if (!needle) return text;
  const index = foldText(text).indexOf(needle);
  if (index <= context) return text;
  return "… " + text.slice(index - context).trimStart();
}

/** Parte el texto en [antes, match, después] para resaltar la coincidencia,
 * o null si el término no aparece. Insensible a acentos. */
export function splitOnMatch(
  text: string,
  term: string,
): [string, string, string] | null {
  const trimmed = term.trim();
  if (!trimmed) return null;
  const index = foldText(text).indexOf(foldText(trimmed));
  if (index < 0) return null;
  return [
    text.slice(0, index),
    text.slice(index, index + trimmed.length),
    text.slice(index + trimmed.length),
  ];
}

export function formatMessageTime(sentAt: string | null): string {
  if (!sentAt) return "";
  const d = new Date(sentAt);
  return d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit" });
}

export function formatDayLabel(sentAt: string): string {
  const date = new Date(sentAt);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return "Hoy";
  if (date.toDateString() === yesterday.toDateString()) return "Ayer";
  return date.toLocaleDateString("es-AR", {
    day: "numeric",
    month: "long",
    year: date.getFullYear() !== today.getFullYear() ? "numeric" : undefined,
  });
}

/** Un día del hilo con todo lo que pasó ese día, en orden. */
export interface DaySection<T> {
  /** Clave estable de React: la del primer ítem de la sección. */
  key: string;
  /** Fecha del día, o null si la sección arranca con ítems sin fecha
   * confirmada (nunca lleva chip). */
  sentAt: string | null;
  items: { item: T; globalIndex: number }[];
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
  const sections: (DaySection<T> & { day: string | null })[] = [];
  items.forEach((item, globalIndex) => {
    const day = item.sentAt ? new Date(item.sentAt).toDateString() : null;
    const current = sections.at(-1);
    if (!current || (day !== null && day !== current.day)) {
      sections.push({
        key: item.key,
        day,
        sentAt: item.sentAt,
        items: [{ item, globalIndex }],
      });
    } else {
      current.items.push({ item, globalIndex });
    }
  });
  return sections;
}

import { resolveMediaUrl } from '../../shared/utils/mediaUrl';
export { resolveMediaUrl } from '../../shared/utils/mediaUrl';

export type RichSegmentType =
  | "text"
  | "link"
  | "bold"
  | "italic"
  | "strike"
  | "code";

export interface RichSegment {
  type: RichSegmentType;
  text: string;
}

const TRAILING_PUNCTUATION = /[.,;:!?)\]}'"]+$/;

// Orden de prioridad: URL, bloque de código, código inline, negrita markdown
// (**x**, común en texto generado por IA), negrita/cursiva/tachado estilo
// WhatsApp (*x*, _x_, ~x~).
const RICH_TEXT_REGEX =
  /(https?:\/\/[^\s]+)|```([^`]+?)```|`([^`\n]+?)`|\*\*([^\n*]+?)\*\*|\*([^\n*]+?)\*|_([^\n_]+?)_|~([^\n~]+?)~/g;

/**
 * Interpreta el mismo formato que usa WhatsApp (*negrita*, _cursiva_,
 * ~tachado~, `código`), más **negrita** estilo markdown, y los links, para
 * renderizarlos como texto con estilo en vez de mostrar los símbolos
 * literales. No soporta formato anidado (ej. un link dentro de una negrita),
 * igual que WhatsApp.
 */
export function parseRichText(text: string): RichSegment[] {
  const segments: RichSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(RICH_TEXT_REGEX)) {
    const start = match.index ?? 0;
    const [full, url, codeBlock, code, boldDouble, boldSingle, italic, strike] =
      match;

    if (url !== undefined) {
      let trimmedUrl = url;
      let trailing = "";
      const punctuation = trimmedUrl.match(TRAILING_PUNCTUATION);
      if (punctuation) {
        trailing = punctuation[0];
        trimmedUrl = trimmedUrl.slice(0, -trailing.length);
      }
      if (!trimmedUrl) continue;

      if (start > lastIndex)
        segments.push({ type: "text", text: text.slice(lastIndex, start) });
      segments.push({ type: "link", text: trimmedUrl });
      if (trailing) segments.push({ type: "text", text: trailing });
      lastIndex = start + full.length;
      continue;
    }

    let type: RichSegmentType;
    let content: string;
    if (codeBlock !== undefined) {
      type = "code";
      content = codeBlock;
    } else if (code !== undefined) {
      type = "code";
      content = code;
    } else if (boldDouble !== undefined) {
      type = "bold";
      content = boldDouble;
    } else if (boldSingle !== undefined) {
      type = "bold";
      content = boldSingle;
    } else if (italic !== undefined) {
      type = "italic";
      content = italic;
    } else if (strike !== undefined) {
      type = "strike";
      content = strike;
    } else {
      continue;
    }

    if (start > lastIndex)
      segments.push({ type: "text", text: text.slice(lastIndex, start) });
    segments.push({ type, text: content });
    lastIndex = start + full.length;
  }

  if (lastIndex < text.length) {
    segments.push({ type: "text", text: text.slice(lastIndex) });
  }

  return segments.length ? segments : [{ type: "text", text }];
}
