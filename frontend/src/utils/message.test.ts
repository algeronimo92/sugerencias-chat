import { describe, expect, it } from 'vitest'

import {
  flowOrderGroup, flowStatusLabel, formatDayLabel, formatFlowAmount, groupByDay, messageAdReferral,
  messageContacts, messageFlowOrder, ORDER_STATUS_LABELS, parseContent, PAYMENT_STATUS_LABELS,
  resolveMediaUrl, searchSnippet, splitOnMatch,
} from './message'

describe('parseContent', () => {
  it('trata el texto suelto como texto', () => {
    expect(parseContent('hola')).toMatchObject({ kind: 'text', text: 'hola', icon: null })
  })

  it('clasifica por message_type cuando el backend lo manda', () => {
    expect(parseContent({ content: 'foto.jpg', message_type: 'image' }).kind).toBe('image')
    expect(parseContent({ content: null, message_type: 'audio' }).kind).toBe('audio')
    expect(parseContent({ content: null, message_type: 'document', payload: { filename: 'x.pdf' } }))
      .toMatchObject({ kind: 'document', label: 'Documento' })
    expect(parseContent({ content: null, message_type: 'sticker' }).kind).toBe('sticker')
    expect(parseContent({ content: 'pregunta', message_type: 'poll' })).toMatchObject({ kind: 'poll', text: 'pregunta' })
    expect(parseContent({ content: 'Pago: Realizado', message_type: 'order' }))
      .toMatchObject({ kind: 'order', label: 'Pedido', text: 'Pago: Realizado' })
    expect(parseContent({ content: 'HIFU 12D', message_type: 'product' }))
      .toMatchObject({ kind: 'product', label: 'Producto' })
    expect(parseContent({ content: 'Separación', message_type: 'payment' }))
      .toMatchObject({ kind: 'payment', label: 'Pago' })
    expect(parseContent({ content: 'Mira esto', message_type: 'view_once', payload: { inner_type: 'image' } }))
      .toMatchObject({ kind: 'view_once', label: 'Ver una vez', text: 'Mira esto' })
  })

  it('normaliza listas modernas como mensajes interactivos', () => {
    const parsed = parseContent({
      content: 'Elige un servicio',
      message_type: 'interactive',
      payload: { title: 'Servicios', body: 'Elige un servicio', options: [{ id: 'hifu', text: 'HIFU' }] },
    })
    expect(parsed.template).toMatchObject({ title: 'Servicios', body: 'Elige un servicio' })
    expect(parsed.template?.buttons).toEqual([{ text: 'HIFU', url: null }])
  })

  it('separa el análisis IA del caption y no lo mezcla en el texto', () => {
    const parsed = parseContent({
      content: 'Mirá esta promo',
      message_type: 'image',
      analysis: { summary: 'La imagen muestra un anuncio de HIFU.' },
    })
    expect(parsed.text).toBe('Mirá esta promo')
    expect(parsed.analysis).toBe('La imagen muestra un anuncio de HIFU.')
  })

  it('un tipo desconocido cae en "unsupported" en vez de perderse', () => {
    expect(parseContent({ content: null, message_type: 'jibberish' as never }))
      .toMatchObject({ kind: 'unsupported', label: 'No soportado' })
  })

  it('respaldo legado: reconoce los pseudo-tags que escribía n8n', () => {
    expect(parseContent('<image></image>').kind).toBe('image')
    expect(parseContent('<audio></audio>').kind).toBe('audio')
    expect(parseContent('<video></video>').kind).toBe('video')
    expect(parseContent('<other>archivo.pdf</other>')).toMatchObject({ kind: 'document', text: 'archivo.pdf' })
    expect(parseContent('<location>-12.04,-77.04</location>')).toMatchObject({
      kind: 'location',
      text: '-12.04,-77.04',
    })
  })

  it('respaldo legado: extrae el bloque Analisis embebido en el content viejo', () => {
    const parsed = parseContent('<image>caption real\n\nAnalisis: descripción de la IA</image>')
    expect(parsed.text).toBe('caption real')
    expect(parsed.analysis).toBe('descripción de la IA')
  })

  it('respaldo legado: separa el análisis aunque el adjunto no tenga caption', () => {
    // El bloque Analisis arranca al principio (imagen sin epígrafe): no debe
    // quedar como caption.
    const parsed = parseContent('<image>\n\nAnalisis: comprobante de pago Yape</image>')
    expect(parsed.text).toBe('')
    expect(parsed.analysis).toBe('comprobante de pago Yape')
  })

  it('respaldo legado: el interior de un audio viejo es transcripción, no caption', () => {
    const parsed = parseContent('<audio>hola qué tal</audio>')
    expect(parsed.text).toBe('')
    expect(parsed.analysis).toBe('hola qué tal')
  })

  it('respaldo legado: una etiqueta desconocida cae en "unsupported"', () => {
    expect(parseContent('<sticker></sticker>')).toMatchObject({ kind: 'unsupported', label: 'No soportado' })
  })

  it('no confunde una etiqueta a medias con multimedia', () => {
    // Un cliente puede escribir esto literalmente; debe salir como texto.
    expect(parseContent('<image>').kind).toBe('text')
    expect(parseContent('mira <image></image> esto').kind).toBe('text')
  })

  it('sobrevive a null y a la cadena vacía', () => {
    expect(parseContent(null)).toMatchObject({ kind: 'text', text: '' })
    expect(parseContent('')).toMatchObject({ kind: 'text', text: '' })
  })
})

// JSON real de un anuncio de TikTok recibido por WhatsApp, recortado.
const TEMPLATE_JSON = JSON.stringify({
  header: { title: '' },
  body: { text: '¡Hola, DermicaPro Trujillo! Tienes 10 mensajes sin leer.' },
  nativeFlowMessage: {
    buttons: [
      {
        name: 'cta_url',
        buttonParamsJson: JSON.stringify({
          display_text: 'Abrir TikTok',
          url: 'https://www.tiktok.com/?redirect_url=sslocal://notification',
        }),
      },
    ],
    messageParamsJson: JSON.stringify({
      tap_target_configuration: {
        title: 'TikTok - Make Your Day',
        domain: 'www.tiktok.com',
        description: 'TikTok - trends start here.',
      },
    }),
  },
})

describe('plantillas de WhatsApp', () => {
  it('muestra el cuerpo del anuncio, no el JSON crudo', () => {
    const parsed = parseContent(`<templateMessage>\n${TEMPLATE_JSON}\n</templateMessage>`)
    expect(parsed.kind).toBe('template')
    expect(parsed.text).toBe('¡Hola, DermicaPro Trujillo! Tienes 10 mensajes sin leer.')
    expect(parsed.text).not.toContain('{')
  })

  it('desarma el preview del enlace y los botones', () => {
    const { template } = parseContent(`<templateMessage>${TEMPLATE_JSON}</templateMessage>`)
    expect(template).toMatchObject({
      title: 'TikTok - Make Your Day',
      domain: 'www.tiktok.com',
      description: 'TikTok - trends start here.',
    })
    expect(template!.buttons).toEqual([
      { text: 'Abrir TikTok', url: 'https://www.tiktok.com/?redirect_url=sslocal://notification' },
    ])
  })

  it('descarta las URLs que no son http(s) para no meterlas en un href', () => {
    const raw = JSON.stringify({
      body: { text: 'hola' },
      nativeFlowMessage: {
        buttons: [{ buttonParamsJson: JSON.stringify({ display_text: 'Tocá acá', url: 'javascript:alert(1)' }) }],
      },
    })
    const { template } = parseContent(`<templateMessage>${raw}</templateMessage>`)
    expect(template!.buttons).toEqual([{ text: 'Tocá acá', url: null }])
  })

  it('no revienta ni filtra el JSON cuando la plantilla viene rota', () => {
    const parsed = parseContent('<templateMessage>{roto</templateMessage>')
    expect(parsed).toMatchObject({ kind: 'template', template: null, text: 'Mensaje de plantilla' })
  })

  it('desarma los buttonsMessage, que traen otra forma de JSON', () => {
    // Mensaje real del vendedor: contentText + buttons[].buttonText.displayText.
    const raw = JSON.stringify({
      buttons: [
        { buttonId: 'c2c5', buttonText: { displayText: 'Si, evalueme' }, type: 1 },
        { buttonId: 'b746', buttonText: { displayText: 'No, tengo otras duda' }, type: 1 },
      ],
      contentText: '📸Eso es todo? 😊',
      headerType: 1,
    })
    const parsed = parseContent(`<buttonsMessage>\n${raw}\n</buttonsMessage>`)
    expect(parsed).toMatchObject({ kind: 'template', label: 'Botones', text: '📸Eso es todo? 😊' })
    expect(parsed.template!.buttons).toEqual([
      { text: 'Si, evalueme', url: null },
      { text: 'No, tengo otras duda', url: null },
    ])
  })

  it('muestra la respuesta del cliente con la pregunta que contestó', () => {
    // Lo que llega cuando el cliente toca un botón: el texto elegido y, dentro
    // del contextInfo, el mensaje original.
    const raw = JSON.stringify({
      selectedButtonId: 'c2c5',
      selectedDisplayText: 'Si, evalueme',
      contextInfo: {
        stanzaId: 'CE70D087C517F6D4870D',
        quotedMessage: {
          buttonsMessage: {
            buttons: [{ buttonId: 'c2c5', buttonText: { displayText: 'Si, evalueme' }, type: 1 }],
            contentText: '📸Eso es todo? 😊',
          },
        },
      },
      type: 1,
    })
    const parsed = parseContent(`<buttonsResponseMessage>\n${raw}\n</buttonsResponseMessage>`)
    expect(parsed).toMatchObject({ kind: 'template', label: 'Respuesta', text: 'Si, evalueme' })
    expect(parsed.template).toMatchObject({
      body: 'Si, evalueme',
      answeredQuestion: '📸Eso es todo? 😊',
    })
    // Los botones del mensaje citado no se repiten en la respuesta.
    expect(parsed.template!.buttons).toEqual([])
  })

  it('toma las respuestas rápidas sin enlace', () => {
    const raw = JSON.stringify({
      body: { text: '¿Confirmás tu cita?' },
      footer: { text: 'DermicaPro' },
      nativeFlowMessage: {
        buttons: [{ buttonParamsJson: JSON.stringify({ display_text: 'Sí', id: '1' }) }],
      },
    })
    const { template } = parseContent(`<templateMessage>${raw}</templateMessage>`)
    expect(template).toMatchObject({ body: '¿Confirmás tu cita?', footer: 'DermicaPro' })
    expect(template!.buttons).toEqual([{ text: 'Sí', url: null }])
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

describe('messageAdReferral', () => {
  it('devuelve null si el mensaje no vino de un anuncio', () => {
    expect(messageAdReferral(null)).toBeNull()
    expect(messageAdReferral({ latitude: 1 })).toBeNull()
    expect(messageAdReferral({ ad_referral: { source_url: 'https://x/y' } })).toBeNull()
  })

  it('lee título, cuerpo, link y ctwa_clid del anuncio', () => {
    const ad = messageAdReferral({
      ad_referral: {
        title: 'DermicaPro',
        body: 'HIFU',
        source_url: 'https://instagram.com/p/abc',
        ctwa_clid: 'AfiYDh',
      },
    })
    expect(ad).toMatchObject({ title: 'DermicaPro', body: 'HIFU', sourceUrl: 'https://instagram.com/p/abc', ctwaClid: 'AfiYDh' })
  })

  it('resuelve la miniatura rehospedada en /media y deja pasar las externas', () => {
    expect(messageAdReferral({ ad_referral: { title: 'x', thumbnail_url: '/media/ad-1.jpg' } })?.thumbnailUrl)
      .toMatch(/\/media\/ad-1\.jpg$/)
    expect(messageAdReferral({ ad_referral: { title: 'x', thumbnail_url: 'https://cdn/x.jpg' } })?.thumbnailUrl)
      .toBe('https://cdn/x.jpg')
  })

  it('descarta miniaturas con esquemas que no sean http ni /media', () => {
    expect(messageAdReferral({ ad_referral: { title: 'x', thumbnail_url: 'javascript:alert(1)' } })?.thumbnailUrl)
      .toBeNull()
  })
})

describe('messageContacts', () => {
  it('devuelve vacío si el mensaje no trae contactos', () => {
    expect(messageContacts(null)).toEqual([])
    expect(messageContacts({ contacts: 'Ana' })).toEqual([])
    expect(messageContacts({ contacts: [{}] })).toEqual([])
  })

  it('lee el nombre y el teléfono ya desarmados por el backend', () => {
    expect(messageContacts({ contacts: [{ fullName: 'Ana', phoneNumber: '+51 987 654 321' }] }))
      .toEqual([{ fullName: 'Ana', phone: '51987654321', phoneLabel: '+51 987 654 321' }])
  })

  it('saca el número del vCard, prefiriendo el waid sobre el TEL visible', () => {
    const vcard =
      'BEGIN:VCARD\nVERSION:3.0\nFN:Lidia Mimbela\n' +
      'TEL;type=CELL;waid=51987654321:987 654 321\nEND:VCARD'
    expect(messageContacts({ contacts: [{ vcard }] }))
      .toEqual([{ fullName: 'Lidia Mimbela', phone: '51987654321', phoneLabel: '987 654 321' }])
  })

  it('lee el TEL agrupado ("item1.TEL") que manda WhatsApp desde Android', () => {
    const vcard =
      'BEGIN:VCARD\nVERSION:3.0\nN:;;;;\nFN:Alger Pier\n' +
      'item1.TEL;waid=51906471403:+51 906 471 403\nitem1.X-ABLabel:Celular\n' +
      'PHOTO;BASE64:/9j/4AAQSkZJRgABAQAAAQABAAD\nEND:VCARD'
    expect(messageContacts({ contacts: [{ displayName: 'Alger Pier Nuevo 1', vcard }] }))
      .toEqual([{ fullName: 'Alger Pier Nuevo 1', phone: '51906471403', phoneLabel: '+51 906 471 403' }])
  })

  it('deja el contacto sin teléfono cuando el vCard no trae uno marcable', () => {
    expect(messageContacts({ contacts: [{ fullName: 'Ana', vcard: 'BEGIN:VCARD\nTEL:123\nEND:VCARD' }] }))
      .toEqual([{ fullName: 'Ana', phone: null, phoneLabel: '123' }])
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

// Payload real (recortado) de un pedido de "Separación de cita" de WhatsApp
// Flow: llega como 3 mensajes `interactive` independientes que comparten
// `reference_id` dentro de `payload.buttons[0]`.
describe('messageFlowOrder', () => {
  it('lee el botón de creación del pedido (review_and_pay)', () => {
    const button = messageFlowOrder({
      buttons: [{
        name: 'review_and_pay',
        amount: 50,
        subtotal: 50,
        currency: 'PEN',
        reference_id: '4W1G98HRIFB',
        order_status: 'payment_requested',
        item_name: 'HIFU 12D',
        quantity: 1,
      }],
    })
    expect(button).toMatchObject({
      name: 'review_and_pay',
      amount: 50,
      currency: 'PEN',
      reference_id: '4W1G98HRIFB',
      order_status: 'payment_requested',
      item_name: 'HIFU 12D',
      quantity: 1,
    })
  })

  it('lee una actualización de estado de pago sin los datos del ítem', () => {
    const button = messageFlowOrder({
      buttons: [{ name: 'payment_status', payment_status: 'captured', reference_id: '4W1G98HRIFB' }],
    })
    expect(button).toMatchObject({ name: 'payment_status', payment_status: 'captured', amount: null, item_name: null })
  })

  it('devuelve null si no hay botones (mensaje interactivo sin forma de pedido)', () => {
    expect(messageFlowOrder({ title: 'Servicios', options: [{ id: 'hifu', text: 'HIFU' }] })).toBeNull()
    expect(messageFlowOrder(null)).toBeNull()
    expect(messageFlowOrder({ buttons: [] })).toBeNull()
  })

  it('devuelve null cuando el botón no es de pedido de WhatsApp Flow ni trae reference_id', () => {
    expect(messageFlowOrder({ buttons: [{ name: 'quick_reply', text: 'Sí' }] })).toBeNull()
    expect(messageFlowOrder({ buttons: [{ name: 'review_and_pay' }] })).toBeNull()
  })
})

describe('flowOrderGroup', () => {
  const referenceId = '4W1G98HRIFB'
  function interactiveMessage(sentAt: string, buttonOverrides: Record<string, unknown>) {
    return {
      message_type: 'interactive' as const,
      sent_at: sentAt,
      payload: { buttons: [{ reference_id: referenceId, ...buttonOverrides }] },
    }
  }

  it('usa el order_status del último mensaje del grupo, no el "payment_requested" original', () => {
    const messages = [
      interactiveMessage('2026-08-01T10:00:00.000Z', {
        name: 'review_and_pay', order_status: 'payment_requested', item_name: 'HIFU 12D', quantity: 1,
        amount: 50, subtotal: 50, currency: 'PEN',
      }),
      interactiveMessage('2026-08-01T10:01:00.000Z', { name: 'payment_status', payment_status: 'captured' }),
      interactiveMessage('2026-08-01T10:02:00.000Z', { name: 'review_order', order_status: 'completed' }),
    ]

    const group = flowOrderGroup(messages, referenceId)
    expect(group).toMatchObject({
      orderStatus: 'completed',
      paymentStatus: 'captured',
      itemName: 'HIFU 12D',
      quantity: 1,
      amount: 50,
      subtotal: 50,
      currency: 'PEN',
    })
  })

  it('no depende del orden de llegada: ordena por sent_at antes de agregar', () => {
    // Los mismos 3 mensajes, pero llegando desordenados a la función.
    const messages = [
      interactiveMessage('2026-08-01T10:02:00.000Z', { name: 'review_order', order_status: 'canceled' }),
      interactiveMessage('2026-08-01T10:00:00.000Z', { name: 'review_and_pay', order_status: 'payment_requested' }),
      interactiveMessage('2026-08-01T10:01:00.000Z', { name: 'payment_status', payment_status: 'declined' }),
    ]

    expect(flowOrderGroup(messages, referenceId)).toMatchObject({ orderStatus: 'canceled', paymentStatus: 'declined' })
  })

  it('si ningún mensaje posterior trae order_status, queda el original', () => {
    const messages = [
      interactiveMessage('2026-08-01T10:00:00.000Z', { name: 'review_and_pay', order_status: 'payment_requested' }),
    ]
    expect(flowOrderGroup(messages, referenceId)).toMatchObject({ orderStatus: 'payment_requested', paymentStatus: null })
  })

  it('ignora mensajes de otro reference_id y los que no son interactive', () => {
    const messages = [
      interactiveMessage('2026-08-01T10:00:00.000Z', { name: 'review_and_pay', order_status: 'payment_requested' }),
      interactiveMessage('2026-08-01T10:01:00.000Z', { reference_id: 'OTRO-PEDIDO', name: 'review_order', order_status: 'completed' } as never),
      { message_type: 'text' as const, sent_at: '2026-08-01T10:02:00.000Z', payload: null },
    ]
    expect(flowOrderGroup(messages, referenceId)).toMatchObject({ orderStatus: 'payment_requested' })
  })
})

describe('flowStatusLabel', () => {
  it('usa la etiqueta del mapa cuando existe', () => {
    expect(flowStatusLabel('captured', PAYMENT_STATUS_LABELS)).toBe('Realizado')
    expect(flowStatusLabel('completed', ORDER_STATUS_LABELS)).toBe('Completado')
  })

  it('capitaliza y reemplaza guiones bajos como respaldo', () => {
    expect(flowStatusLabel('some_weird_status', ORDER_STATUS_LABELS)).toBe('Some weird status')
  })

  it('devuelve vacío sin estado', () => {
    expect(flowStatusLabel(null, ORDER_STATUS_LABELS)).toBe('')
  })
})

describe('formatFlowAmount', () => {
  it('usa el símbolo pegado al monto para PEN y USD, como el backend', () => {
    expect(formatFlowAmount(50, 'PEN')).toBe('S/50.00')
    expect(formatFlowAmount(19.9, 'USD')).toBe('$19.90')
  })

  it('cae al código de moneda con espacio cuando no es PEN/USD', () => {
    expect(formatFlowAmount(30, 'EUR')).toBe('EUR 30.00')
  })

  it('sin monto no arma texto (la fila se oculta, no se inventa un 0)', () => {
    expect(formatFlowAmount(null, 'PEN')).toBe('')
  })
})
