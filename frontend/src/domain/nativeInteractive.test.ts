import { describe, expect, it } from 'vitest'

import {
  availableNativeInteractives, buildNativeInteractive, EMPTY_NATIVE_INTERACTIVE_FORM, parseSkus,
  type NativeInteractiveForm, type NativeInteractiveKind,
} from './nativeInteractive'

const CAPABILITIES = {
  catalog_enabled: true,
  flows_enabled: true,
  call_permission_enabled: true,
  catalog_id: '1234567890',
  published_flows: ['987654321', 'agenda'],
}

function form(kind: NativeInteractiveKind, overrides: Partial<NativeInteractiveForm> = {}): NativeInteractiveForm {
  return { ...EMPTY_NATIVE_INTERACTIVE_FORM, kind, ...overrides }
}

describe('availableNativeInteractives', () => {
  it('solo ofrece lo que la cuenta tiene habilitado', () => {
    expect(availableNativeInteractives(undefined)).toEqual([])
    expect(availableNativeInteractives({ ...CAPABILITIES, flows_enabled: false, call_permission_enabled: false }))
      .toEqual(['product', 'product_list', 'catalog_message'])
    expect(availableNativeInteractives({ ...CAPABILITIES, catalog_enabled: false, catalog_id: null }))
      .toEqual(['flow', 'call_permission_request'])
  })
})

describe('buildNativeInteractive', () => {
  it('arma un producto con el catálogo de la cuenta', () => {
    expect(buildNativeInteractive(form('product', { sku: ' SKU-001 ', body: 'Te recomiendo este' }), CAPABILITIES))
      .toEqual({
        errors: [],
        interactive: {
          type: 'product',
          body: { text: 'Te recomiendo este' },
          action: { catalog_id: '1234567890', product_retailer_id: 'SKU-001' },
        },
      })
  })

  it('arma una lista de productos sin SKUs repetidos', () => {
    const result = buildNativeInteractive(form('product_list', {
      header: 'Cremas', body: 'Nuestras cremas', sectionTitle: 'Hidratantes', skus: 'SKU-001\nSKU-002, SKU-001',
    }), CAPABILITIES)
    expect(result.interactive).toEqual({
      type: 'product_list',
      header: { type: 'text', text: 'Cremas' },
      body: { text: 'Nuestras cremas' },
      action: {
        catalog_id: '1234567890',
        sections: [{ title: 'Hidratantes', product_items: [{ product_retailer_id: 'SKU-001' }, { product_retailer_id: 'SKU-002' }] }],
      },
    })
  })

  it('arma un mensaje de catálogo con miniatura opcional', () => {
    expect(buildNativeInteractive(form('catalog_message', { body: 'Mira nuestro catálogo', sku: 'SKU-001' }), CAPABILITIES).interactive)
      .toEqual({
        type: 'catalog_message',
        body: { text: 'Mira nuestro catálogo' },
        action: { name: 'catalog_message', parameters: { thumbnail_product_retailer_id: 'SKU-001' } },
      })
    expect(buildNativeInteractive(form('catalog_message', { body: 'Mira' }), CAPABILITIES).interactive)
      .toMatchObject({ action: { name: 'catalog_message' } })
  })

  it('usa flow_id para un id numérico y flow_name para un nombre', () => {
    const byId = buildNativeInteractive(form('flow', {
      body: 'Completa tu reserva', flow: '987654321', flowCta: 'Reservar', flowScreen: 'RESERVA',
    }), CAPABILITIES)
    expect(byId.interactive).toEqual({
      type: 'flow',
      body: { text: 'Completa tu reserva' },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_id: '987654321',
          flow_cta: 'Reservar',
          flow_action: 'navigate',
          flow_action_payload: { screen: 'RESERVA' },
        },
      },
    })
    const byName = buildNativeInteractive(form('flow', {
      body: 'Agenda', flow: 'agenda', flowCta: 'Abrir', flowAction: 'data_exchange',
    }), CAPABILITIES)
    expect(byName.interactive).toMatchObject({
      action: { parameters: { flow_name: 'agenda', flow_action: 'data_exchange' } },
    })
    expect(JSON.stringify(byName.interactive)).not.toContain('flow_action_payload')
  })

  it('rechaza un Flow que no está publicado y una navegación sin pantalla', () => {
    const result = buildNativeInteractive(form('flow', { body: 'x', flow: 'otro', flowCta: 'Abrir' }), CAPABILITIES)
    expect(result.interactive).toBeNull()
    expect(result.errors).toEqual(['Ese Flow no está publicado en la cuenta.', 'Indica la pantalla inicial del Flow.'])
  })

  it('arma el pedido de permiso de llamada', () => {
    expect(buildNativeInteractive(form('call_permission_request', { body: '¿Podemos llamarte?' }), CAPABILITIES).interactive)
      .toEqual({
        type: 'call_permission_request',
        body: { text: '¿Podemos llamarte?' },
        action: { name: 'call_permission_request' },
      })
  })

  it('valida los campos obligatorios y los límites de Meta', () => {
    expect(buildNativeInteractive(form('product'), CAPABILITIES).errors).toEqual(['Indica el SKU del producto.'])
    expect(buildNativeInteractive(form('call_permission_request', { body: 'x'.repeat(1025) }), CAPABILITIES).errors)
      .toEqual(['El cuerpo admite máximo 1024 caracteres.'])
    const tooMany = Array.from({ length: 31 }, (_, index) => `SKU-${index}`).join('\n')
    expect(buildNativeInteractive(form('product_list', { header: 'H', body: 'B', skus: tooMany }), CAPABILITIES).errors)
      .toEqual(['La lista admite máximo 30 productos.'])
  })
})

describe('parseSkus', () => {
  it('acepta líneas y comas', () => {
    expect(parseSkus(' a,\nb ,, a ')).toEqual(['a', 'b'])
  })
})
