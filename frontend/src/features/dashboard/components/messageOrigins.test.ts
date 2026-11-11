import { describe, expect, it } from 'vitest'
import { originHeadline, originShares } from './messageOrigins'

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
