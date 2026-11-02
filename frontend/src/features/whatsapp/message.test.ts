import { describe, expect, it } from 'vitest'

import {
  formatDayLabel, formatMoney, groupByDay, isKnownMessageType, messageAdReferral, messageContacts,
  messageCoords, messageFlowReply, messageOrder, messageProducts, messageReply, messageSystemNotice,
  metaErrors, parseContent, quotePreview, resolveMediaUrl, searchSnippet, splitOnMatch,
  TEMPLATE_FALLBACK_TEXT,
} from './message'

describe('parseContent', () => {
  it('trata el texto suelto como texto', () => {
    expect(parseContent('hola')).toMatchObject({ kind: 'text', text: 'hola', icon: null, known: true })
    expect(parseContent(null)).toMatchObject({ kind: 'text', text: '' })
  })

  it('clasifica por el tipo literal de Meta', () => {
    expect(parseContent({ content: 'foto.jpg', message_type: 'image' })).toMatchObject({ kind: 'image', label: 'Imagen' })
    expect(parseContent({ content: null, message_type: 'audio' }).kind).toBe('audio')
    expect(parseContent({ content: null, message_type: 'document' })).toMatchObject({ kind: 'document', label: 'Documento' })
    expect(parseContent({ content: null, message_type: 'contacts' })).toMatchObject({ kind: 'contacts', label: 'Contacto' })
    expect(parseContent({ content: null, message_type: 'order' })).toMatchObject({ kind: 'order', label: 'Pedido' })
  })

  it('lee el objeto de Meta desde provider_payload antes que la proyección del CRM', () => {
    const parsed = parseContent({
      content: null,
      message_type: 'location',
      payload: { forwarded: true },
      provider_payload: { location: { latitude: -12.1, longitude: -77.03 } },
    })
    expect(parsed.meta).toEqual({ location: { latitude: -12.1, longitude: -77.03 } })
    expect(parsed.payload).toEqual({ forwarded: true })
    expect(messageCoords(parsed.meta)).toEqual([-12.1, -77.03])
  })

  it('un tipo que el contrato no conoce se muestra con su nombre literal', () => {
    const parsed = parseContent({ content: null, message_type: 'future_thing' })
    expect(parsed).toMatchObject({ kind: 'future_thing', known: false, label: 'Mensaje future_thing' })
    const sub = parseContent({ content: null, message_type: 'interactive', message_subtype: 'nuevo_subtipo' })
    expect(sub).toMatchObject({ known: false, label: 'Mensaje interactive/nuevo_subtipo' })
  })

  it('unknown y unsupported de Meta son tipos conocidos con su rótulo', () => {
    expect(parseContent({ content: null, message_type: 'unsupported' }))
      .toMatchObject({ known: true, label: 'No soportado por WhatsApp' })
    expect(isKnownMessageType('unknown', null)).toBe(true)
  })

  it('arma el interactivo de botones desde la estructura de Meta', () => {
    const parsed = parseContent({
      content: 'Hola Gerson lee esto',
      message_type: 'interactive',
      message_subtype: 'button',
      provider_payload: {
        interactive: {
          type: 'button',
          header: { type: 'text', text: 'Presiona un boton' },
          body: { text: 'Hola Gerson lee esto' },
          footer: { text: 'DermicaPro' },
          action: {
            buttons: [
              { type: 'reply', reply: { id: 'reply_1', title: 'opcion a' } },
              { type: 'reply', reply: { id: 'reply_2', title: 'opcion b' } },
            ],
          },
        },
      },
    })
    expect(parsed).toMatchObject({ kind: 'interactive', subtype: 'button', label: 'Botones', text: 'Hola Gerson lee esto' })
    expect(parsed.template).toEqual({
      title: 'Presiona un boton',
      body: 'Hola Gerson lee esto',
      footer: 'DermicaPro',
      buttons: [{ text: 'opcion a', url: null }, { text: 'opcion b', url: null }],
      headerImageUrl: null,
    })
  })

  it('una lista muestra solo el botón que la abre', () => {
    const parsed = parseContent({
      content: null,
      message_type: 'interactive',
      message_subtype: 'list',
      provider_payload: {
        interactive: {
          type: 'list',
          body: { text: 'Elige un servicio' },
          action: { button: 'Ver servicios', sections: [{ title: 'S', rows: [{ id: 'hifu', title: 'HIFU' }] }] },
        },
      },
    })
    expect(parsed.text).toBe('Elige un servicio')
    expect(parsed.template?.buttons).toEqual([{ text: 'Ver servicios', url: null }])
  })

  it('la plantilla oficial toma encabezado, pie y botones de la proyección del CRM', () => {
    const parsed = parseContent({
      content: 'Tu cita es mañana',
      message_type: 'template',
      payload: {
        template: {
          header_text: 'Recordatorio',
          footer: 'DermicaPro',
          buttons: [
            { type: 'url', text: 'Ver cita', url: 'https://example.com/c' },
            { type: 'url', text: 'Malo', url: 'javascript:alert(1)' },
            { type: 'quick_reply', text: 'Confirmo' },
          ],
        },
      },
    })
    expect(parsed.text).toBe('Tu cita es mañana')
    expect(parsed.template).toMatchObject({
      title: 'Recordatorio',
      footer: 'DermicaPro',
      buttons: [
        { text: 'Ver cita', url: 'https://example.com/c' },
        { text: 'Malo', url: null },
        { text: 'Confirmo', url: null },
      ],
    })
  })

  it('una plantilla sin cuerpo usa el texto de reserva', () => {
    expect(parseContent({ content: null, message_type: 'template' }).text).toBe(TEMPLATE_FALLBACK_TEXT)
  })

  it('separa el resumen del análisis IA del texto', () => {
    const parsed = parseContent({ content: 'foto', message_type: 'image', analysis: { summary: ' Una crema ' } })
    expect(parsed).toMatchObject({ text: 'foto', analysis: 'Una crema' })
  })
})

describe('respuestas del cliente', () => {
  it('regresión OpcionA: la respuesta a un botón de plantilla se ve con su texto', () => {
    // Meta manda `button` (no `interactive`) al tocar un botón de plantilla.
    const message = {
      content: 'OpcionA',
      message_type: 'button' as const,
      provider_payload: { button: { text: 'OpcionA', payload: 'opcion_a' } },
    }
    const parsed = parseContent(message)
    expect(parsed).toMatchObject({ kind: 'button', label: 'Respuesta', text: 'OpcionA', known: true })
    expect(messageReply(parsed)).toEqual({ title: 'OpcionA', id: 'opcion_a', description: '' })
    expect(quotePreview(message)).toMatchObject({ label: 'Respuesta', text: 'OpcionA' })
  })

  it('sin content, toma el texto del botón del objeto de Meta', () => {
    expect(parseContent({
      content: null,
      message_type: 'button',
      provider_payload: { button: { text: 'OpcionA', payload: 'opcion_a' } },
    }).text).toBe('OpcionA')
  })

  it('lee button_reply y list_reply con su id literal', () => {
    const button = parseContent({
      content: 'Sí',
      message_type: 'interactive',
      message_subtype: 'button_reply',
      provider_payload: { interactive: { type: 'button_reply', button_reply: { id: 'si', title: 'Sí' } } },
    })
    expect(button.label).toBe('Respuesta')
    expect(messageReply(button)).toEqual({ title: 'Sí', id: 'si', description: '' })

    const list = parseContent({
      content: 'HIFU',
      message_type: 'interactive',
      message_subtype: 'list_reply',
      provider_payload: {
        interactive: { type: 'list_reply', list_reply: { id: 'hifu', title: 'HIFU', description: '12D' } },
      },
    })
    expect(list.label).toBe('Selección')
    expect(messageReply(list)).toEqual({ title: 'HIFU', id: 'hifu', description: '12D' })
  })

  it('messageReply no aplica a otros tipos', () => {
    expect(messageReply(parseContent('hola'))).toBeNull()
  })

  it('desarma el response_json de un Flow sin listar el flow_token', () => {
    const reply = messageFlowReply({
      interactive: {
        type: 'nfm_reply',
        nfm_reply: {
          name: 'flow',
          body: 'Sent',
          response_json: '{"flow_token":"t","nombre":"Ana","edad":30}',
        },
      },
    })
    expect(reply).toEqual({
      name: 'flow',
      body: 'Sent',
      fields: [{ key: 'nombre', value: 'Ana' }, { key: 'edad', value: '30' }],
    })
  })

  it('un response_json que no es JSON se muestra tal cual', () => {
    const reply = messageFlowReply({ interactive: { nfm_reply: { response_json: 'texto' } } })
    expect(reply.fields).toEqual([{ key: 'respuesta', value: 'texto' }])
  })
})

describe('messageOrder', () => {
  it('suma por moneda con los valores literales de Meta', () => {
    const order = messageOrder({
      order: {
        catalog_id: 'cat',
        text: 'Quiero esto',
        product_items: [
          { product_retailer_id: 'a', quantity: 2, item_price: 10.5, currency: 'PEN' },
          { product_retailer_id: 'b', quantity: 1, item_price: 5, currency: 'PEN' },
          { product_retailer_id: 'c', quantity: 1, item_price: 3, currency: 'USD' },
        ],
      },
    })
    expect(order.catalogId).toBe('cat')
    expect(order.items).toHaveLength(3)
    expect(order.totals).toEqual([{ currency: 'PEN', amount: 26 }, { currency: 'USD', amount: 3 }])
    expect(formatMoney(26, 'PEN')).toMatch(/^PEN 26[.,]00$/)
  })
})

describe('messageProducts', () => {
  it('lee el producto por el que pregunta el cliente desde context.referred_product', () => {
    const parsed = parseContent({
      content: '¿Tienen stock?',
      message_type: 'text',
      provider_payload: { context: { referred_product: { catalog_id: 'cat', product_retailer_id: 'sku1' } } },
    })
    expect(messageProducts(parsed)).toEqual([{ catalogId: 'cat', sku: 'sku1' }])
  })

  it('lee los productos de un product_list enviado', () => {
    const parsed = parseContent({
      content: null,
      message_type: 'interactive',
      message_subtype: 'product_list',
      provider_payload: {
        interactive: {
          type: 'product_list',
          action: {
            catalog_id: 'cat',
            sections: [{ title: 'S', product_items: [{ product_retailer_id: 'a' }, { product_retailer_id: 'b' }] }],
          },
        },
      },
    })
    expect(messageProducts(parsed)).toEqual([{ catalogId: 'cat', sku: 'a' }, { catalogId: 'cat', sku: 'b' }])
  })
})

describe('system y errores', () => {
  it('lee el aviso de sistema y lo usa como texto', () => {
    const meta = { system: { body: 'El usuario cambió de número', type: 'user_changed_number' } }
    expect(messageSystemNotice(meta)).toEqual({ body: 'El usuario cambió de número', type: 'user_changed_number' })
    expect(parseContent({ content: null, message_type: 'system', provider_payload: meta }).text)
      .toBe('El usuario cambió de número')
  })

  it('normaliza los errores de Meta', () => {
    expect(metaErrors({
      errors: [{ code: 131026, title: 'Message undeliverable', error_data: { details: 'x' } }],
    })).toEqual([{ code: '131026', title: 'Message undeliverable', details: 'x' }])
    expect(metaErrors(null)).toEqual([])
  })
})

describe('messageAdReferral', () => {
  it('lee el referral literal de Meta y prefiere la miniatura rehospedada', () => {
    const parsed = parseContent({
      content: 'Hola',
      message_type: 'text',
      payload: { referral_thumbnail_url: 'https://cdn.example/t.jpg' },
      provider_payload: {
        referral: {
          headline: 'Promo HIFU',
          body: 'Solo este mes',
          source_url: 'https://fb.me/ad',
          thumbnail_url: 'https://scontent/x.jpg',
          ctwa_clid: 'clid',
        },
      },
    })
    expect(messageAdReferral(parsed)).toEqual({
      title: 'Promo HIFU',
      body: 'Solo este mes',
      sourceUrl: 'https://fb.me/ad',
      thumbnailUrl: 'https://cdn.example/t.jpg',
      ctwaClid: 'clid',
    })
  })

  it('devuelve null si el mensaje no vino de un anuncio', () => {
    expect(messageAdReferral(parseContent('hola'))).toBeNull()
  })
})

describe('messageContacts', () => {
  it('prefiere wa_id sobre el número visible', () => {
    const contacts = messageContacts({
      contacts: [
        {
          name: { formatted_name: 'Ana Pérez', first_name: 'Ana' },
          phones: [{ phone: '+51 999 888 777', wa_id: '51999888777', type: 'CELL' }],
        },
        { name: { first_name: 'Sin número' }, phones: [] },
      ],
    })
    expect(contacts).toEqual([
      { name: 'Ana Pérez', phone: ['51999888777'], phoneLabel: '+51 999 888 777' },
      { name: 'Sin número', phone: null, phoneLabel: '' },
    ])
  })

  it('sin contactos devuelve una lista vacía', () => {
    expect(messageContacts({})).toEqual([])
  })
})

describe('resolveMediaUrl', () => {
  it('deja pasar intactas las URLs que ya son absolutas o locales', () => {
    // Los mensajes optimistas usan data:/blob: hasta que el backend responde.
    expect(resolveMediaUrl('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA')
    expect(resolveMediaUrl('blob:http://x/1')).toBe('blob:http://x/1')
    expect(resolveMediaUrl('https://cdn.example/x.jpg')).toBe('https://cdn.example/x.jpg')
  })

  it('devuelve null cuando no hay media', () => {
    expect(resolveMediaUrl(null)).toBeNull()
  })

  it('prefija las rutas relativas del backend', () => {
    // En producción VITE_API_BASE_URL está vacío y la ruta queda relativa, que
    // es lo que hace que el navegador mande la cookie de sesión a /media/.
    const resolved = resolveMediaUrl('/media/foto.jpg')
    expect(resolved).toMatch(/\/media\/foto\.jpg$/)
  })
})

describe('searchSnippet', () => {
  it('devuelve el texto tal cual si el término aparece al principio', () => {
    expect(searchSnippet('hola mundo', 'hola')).toBe('hola mundo')
  })

  it('recorta por delante para que el término quede visible', () => {
    const text = 'a'.repeat(60) + ' tratamiento facial'
    const snippet = searchSnippet(text, 'tratamiento')
    expect(snippet.startsWith('… ')).toBe(true)
    expect(snippet).toContain('tratamiento')
    expect(snippet.length).toBeLessThan(text.length)
  })

  it('ignora acentos, como la búsqueda del backend', () => {
    expect(searchSnippet('consulta de depilación', 'depilacion')).toContain('depilación')
  })
})

describe('splitOnMatch', () => {
  it('parte el texto en antes, coincidencia y después', () => {
    expect(splitOnMatch('hola mundo', 'mundo')).toEqual(['hola ', 'mundo', ''])
  })

  it('devuelve null cuando el término no aparece', () => {
    expect(splitOnMatch('hola', 'xyz')).toBeNull()
    expect(splitOnMatch('hola', '   ')).toBeNull()
  })

  it('respeta los acentos del texto original al resaltar', () => {
    const parts = splitOnMatch('cita de depilación hoy', 'depilacion')
    expect(parts).not.toBeNull()
    expect(parts!.join('')).toBe('cita de depilación hoy')
  })
})

describe('formatDayLabel', () => {
  it('usa etiquetas relativas para hoy y ayer', () => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)

    expect(formatDayLabel(today.toISOString())).toBe('Hoy')
    expect(formatDayLabel(yesterday.toISOString())).toBe('Ayer')
  })

  it('para fechas antiguas da una fecha legible, no una etiqueta relativa', () => {
    const label = formatDayLabel('2020-03-15T10:00:00.000Z')
    expect(label).not.toBe('Hoy')
    expect(label).not.toBe('Ayer')
    expect(label).toContain('2020')
  })
})

describe('groupByDay', () => {
  const item = (key: string, sentAt: string | null) => ({ key, sentAt })

  it('abre una sección por cada día', () => {
    const sections = groupByDay([
      item('a', '2024-05-01T10:00:00.000Z'),
      item('b', '2024-05-01T18:00:00.000Z'),
      item('c', '2024-05-02T09:00:00.000Z'),
    ])

    expect(sections.map(s => s.items.map(i => i.item.key))).toEqual([['a', 'b'], ['c']])
    expect(sections.map(s => s.key)).toEqual(['a', 'c'])
  })

  it('conserva la posición global de cada ítem a través de las secciones', () => {
    const sections = groupByDay([
      item('a', '2024-05-01T10:00:00.000Z'),
      item('b', '2024-05-02T09:00:00.000Z'),
      item('c', '2024-05-02T10:00:00.000Z'),
    ])

    expect(sections.flatMap(s => s.items.map(i => i.globalIndex))).toEqual([0, 1, 2])
  })

  it('un mensaje sin fecha confirmada no parte el día ni repite el chip', () => {
    // Un audio recién enviado llega sin sent_at: si cerrara la sección, el
    // mensaje siguiente abriría otra con el chip repetido del mismo día.
    const sections = groupByDay([
      item('a', '2024-05-01T10:00:00.000Z'),
      item('audio-optimista', null),
      item('b', '2024-05-01T11:00:00.000Z'),
    ])

    expect(sections).toHaveLength(1)
    expect(sections[0].items.map(i => i.item.key)).toEqual(['a', 'audio-optimista', 'b'])
  })

  it('no le pone chip a una sección que arranca sin fecha', () => {
    const sections = groupByDay([item('sin-fecha', null), item('a', '2024-05-01T10:00:00.000Z')])

    expect(sections[0].sentAt).toBeNull()
    expect(sections[1].sentAt).toBe('2024-05-01T10:00:00.000Z')
  })

  it('sin ítems no arma ninguna sección', () => {
    expect(groupByDay([])).toEqual([])
  })
})
