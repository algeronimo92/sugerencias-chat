import { describe, expect, it } from 'vitest'
import { PANEL_MAX_HEIGHT, panelRoom } from './usePanelRoom'

const bell = (top: number) => new DOMRect(16, top, 36, 36)

describe('alto del panel de notificaciones', () => {
  it('en el riel crece hacia arriba solo hasta el borde de la ventana', () => {
    // Ventana baja: la campana queda a 520 px del borde superior.
    expect(panelRoom('rail', bell(484), 560)).toBe(520 - 12)
  })

  it('con espacio de sobra no pasa del tope', () => {
    expect(panelRoom('rail', bell(1000), 1080)).toBe(PANEL_MAX_HEIGHT)
  })

  it('en el riel expandido abre arriba de la campana, sin taparla', () => {
    expect(panelRoom('toolbar', bell(484), 560)).toBe(484 - 8 - 12)
  })

  it('en la barra superior abre hacia abajo', () => {
    expect(panelRoom('header', bell(8), 500)).toBe(500 - 44 - 12)
  })
})
