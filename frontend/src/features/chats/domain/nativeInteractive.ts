import type { JsonObject } from '../../../shared/types'
import type { TemplateCapabilities } from '../../templates/types'
import { META_CONTRACT } from '../../whatsapp/public/metaContract'

/** Interactivos de Meta que dependen de la cuenta conectada (catálogo, Flows
 * publicados, permiso de llamadas). Botones y listas salen de las plantillas
 * internas; estos se arman a mano desde el chat. */
export type NativeInteractiveKind =
  | 'product'
  | 'product_list'
  | 'catalog_message'
  | 'flow'
  | 'call_permission_request'

export const NATIVE_INTERACTIVE_LABELS: Record<NativeInteractiveKind, string> = {
  product: 'Producto',
  product_list: 'Lista de productos',
  catalog_message: 'Catálogo',
  flow: 'Formulario (Flow)',
  call_permission_request: 'Permiso de llamada',
}

export type FlowAction = 'navigate' | 'data_exchange'

export interface NativeInteractiveForm {
  kind: NativeInteractiveKind
  header: string
  body: string
  footer: string
  /** SKU (`product_retailer_id`) del producto o de la miniatura del catálogo. */
  sku: string
  /** SKUs de la lista de productos, uno por línea o separados por coma. */
  skus: string
  sectionTitle: string
  /** Id o nombre del Flow, tal como está publicado en la cuenta. */
  flow: string
  flowCta: string
  flowAction: FlowAction
  flowScreen: string
}

export const EMPTY_NATIVE_INTERACTIVE_FORM: Omit<NativeInteractiveForm, 'kind'> = {
  header: '',
  body: '',
  footer: '',
  sku: '',
  skus: '',
  sectionTitle: 'Productos',
  flow: '',
  flowCta: '',
  flowAction: 'navigate',
  flowScreen: '',
}

type Capabilities = Pick<
  TemplateCapabilities,
  'catalog_enabled' | 'flows_enabled' | 'call_permission_enabled' | 'catalog_id' | 'published_flows'
>

/** Qué interactivos puede mandar la cuenta: los que no tiene habilitados el
 * backend los rechaza igual, así que ni se ofrecen. */
export function availableNativeInteractives(capabilities: Capabilities | undefined): NativeInteractiveKind[] {
  if (!capabilities) return []
  const kinds: NativeInteractiveKind[] = []
  if (capabilities.catalog_enabled && capabilities.catalog_id) kinds.push('product', 'product_list', 'catalog_message')
  if (capabilities.flows_enabled && capabilities.published_flows?.length) kinds.push('flow')
  if (capabilities.call_permission_enabled) kinds.push('call_permission_request')
  return kinds
}

const LIMITS = META_CONTRACT.limits

export function parseSkus(value: string): string[] {
  return [...new Set(value.split(/[\n,]/).map(item => item.trim()).filter(Boolean))]
}

function textPart(text: string): JsonObject | null {
  const trimmed = text.trim()
  return trimmed ? { text: trimmed } : null
}

function checkLength(errors: string[], label: string, value: string, limit: number) {
  if (value.trim().length > limit) errors.push(`${label} admite máximo ${limit} caracteres.`)
}

export interface NativeInteractiveResult {
  interactive: JsonObject | null
  errors: string[]
}

/** Arma el objeto `interactive` de Meta tal cual lo recibe
 * `POST /chats/{id}/interactive`, o los errores que impiden mandarlo. */
export function buildNativeInteractive(form: NativeInteractiveForm, capabilities: Capabilities): NativeInteractiveResult {
  const errors: string[] = []
  const body = textPart(form.body)
  const footer = textPart(form.footer)
  checkLength(errors, 'El cuerpo', form.body, LIMITS.body)
  checkLength(errors, 'El pie', form.footer, LIMITS.footer)
  const catalogId = capabilities.catalog_id ?? ''

  let interactive: JsonObject
  switch (form.kind) {
    case 'product': {
      const sku = form.sku.trim()
      if (!sku) errors.push('Indica el SKU del producto.')
      interactive = {
        type: 'product',
        ...(body ? { body } : {}),
        ...(footer ? { footer } : {}),
        action: { catalog_id: catalogId, product_retailer_id: sku },
      }
      break
    }
    case 'product_list': {
      const header = form.header.trim()
      const skus = parseSkus(form.skus)
      if (!header) errors.push('La lista de productos necesita un encabezado.')
      checkLength(errors, 'El encabezado', header, LIMITS.header_text)
      if (!body) errors.push('Escribe el cuerpo del mensaje.')
      if (!skus.length) errors.push('Agrega al menos un SKU.')
      if (skus.length > LIMITS.max_products) errors.push(`La lista admite máximo ${LIMITS.max_products} productos.`)
      const sectionTitle = form.sectionTitle.trim() || 'Productos'
      checkLength(errors, 'El título de la sección', sectionTitle, LIMITS.section_title)
      interactive = {
        type: 'product_list',
        header: { type: 'text', text: header },
        body: body ?? { text: '' },
        ...(footer ? { footer } : {}),
        action: {
          catalog_id: catalogId,
          sections: [{ title: sectionTitle, product_items: skus.map(sku => ({ product_retailer_id: sku })) }],
        },
      }
      break
    }
    case 'catalog_message': {
      if (!body) errors.push('Escribe el cuerpo del mensaje.')
      const thumbnail = form.sku.trim()
      interactive = {
        type: 'catalog_message',
        body: body ?? { text: '' },
        ...(footer ? { footer } : {}),
        action: {
          name: 'catalog_message',
          ...(thumbnail ? { parameters: { thumbnail_product_retailer_id: thumbnail } } : {}),
        },
      }
      break
    }
    case 'flow': {
      const flow = form.flow.trim()
      const cta = form.flowCta.trim()
      const screen = form.flowScreen.trim()
      if (!body) errors.push('Escribe el cuerpo del mensaje.')
      if (!flow) errors.push('Elige el Flow a enviar.')
      else if (!(capabilities.published_flows ?? []).includes(flow)) errors.push('Ese Flow no está publicado en la cuenta.')
      if (!cta) errors.push('Escribe el texto del botón.')
      checkLength(errors, 'El texto del botón', cta, LIMITS.button_title)
      if (form.flowAction === 'navigate' && !screen) errors.push('Indica la pantalla inicial del Flow.')
      const header = textPart(form.header)
      interactive = {
        type: 'flow',
        ...(header ? { header: { type: 'text', ...header } } : {}),
        body: body ?? { text: '' },
        ...(footer ? { footer } : {}),
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            // Meta acepta el id numérico o el nombre del Flow publicado.
            ...(/^\d+$/.test(flow) ? { flow_id: flow } : { flow_name: flow }),
            flow_cta: cta,
            flow_action: form.flowAction,
            ...(form.flowAction === 'navigate' ? { flow_action_payload: { screen } } : {}),
          },
        },
      }
      break
    }
    case 'call_permission_request': {
      if (!body) errors.push('Escribe el cuerpo del mensaje.')
      interactive = {
        type: 'call_permission_request',
        body: body ?? { text: '' },
        ...(footer ? { footer } : {}),
        action: { name: 'call_permission_request' },
      }
      break
    }
  }
  return { interactive: errors.length ? null : interactive, errors }
}
