import { describe, expect, it } from 'vitest'
import { MIN_SEGMENT_PX, SEGMENT_GAP_PX, originHeadline, originShares, segmentBox, type MessageOrigin } from './messageOrigins'

const day = (app: number, automation: number, scheduled: number, phone: number) => ({ date: '2026-11-10', app, automation, scheduled, phone })

describe('orígenes de los mensajes', () => {
  it('deja fuera del reparto y del titular los orígenes sin mensajes', () => {
    const shares = originShares([day(0, 512, 0, 496)])
    expect(shares.map((item) => item.key)).toEqual(['phone', 'automation'])
    expect(originHeadline('1,008', shares)).toBe(
      '1,008 mensajes del negocio: el 49% salió desde WhatsApp por fuera del CRM y el 51% lo mandaron los flujos automáticos.',
    )
  })

  it('no redondea a 0% un origen que sí tuvo mensajes', () => {
    const shares = originShares([day(1, 600, 0, 400)])
    expect(originHeadline('1,001', shares)).toContain('mensajes del negocio: menos del 1% se escribió en el CRM, el 40%')
  })
})

describe('segmentos de la barra apilada', () => {
  // Un día como el del reporte: 13 escritos en el CRM, 16 desde WhatsApp y 270
  // de flujos, con un eje donde cada mensaje mide 0.125px.
  const counts = { app: 13, phone: 16, automation: 270, scheduled: 0 }
  const order: MessageOrigin[] = ['app', 'phone', 'automation']
  const PX = 0.125
  const BASELINE = 200
  // Lo que da la escala del gráfico para cada segmento, sin mínimo.
  const scaled = (key: MessageOrigin) => {
    const below = order.slice(0, order.indexOf(key)).reduce((sum, origin) => sum + counts[origin], 0)
    const height = counts[key] * PX
    return { y: BASELINE - below * PX - height, height }
  }
  const box = (key: MessageOrigin) => segmentBox(counts, key, order, scaled(key))!

  it('un origen con pocos mensajes igual se ve en la barra', () => {
    expect(scaled('app').height).toBeLessThan(SEGMENT_GAP_PX)
    expect(box('app').height).toBe(MIN_SEGMENT_PX - SEGMENT_GAP_PX)
    expect(box('phone').height).toBe(MIN_SEGMENT_PX - SEGMENT_GAP_PX)
  })

  it('los segmentos no se pisan: cada uno empieza donde termina el de abajo', () => {
    expect(box('app').y + box('app').height).toBe(BASELINE)
    expect(box('phone').y + box('phone').height).toBe(box('app').y - SEGMENT_GAP_PX)
    expect(box('automation').y + box('automation').height).toBe(box('phone').y - SEGMENT_GAP_PX)
  })

  it('un segmento grande conserva su alto, menos el hueco que lo separa', () => {
    expect(box('automation').height).toBeCloseTo(270 * PX - SEGMENT_GAP_PX)
  })

  it('no dibuja nada para un origen sin mensajes ese día', () => {
    expect(segmentBox({ ...counts, app: 0 }, 'app', order, { y: BASELINE, height: 0 })).toBeNull()
  })
})
