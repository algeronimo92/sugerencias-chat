import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_BRAND, applyBrand, brandShades, contrastRatio, currentBrandName, loadBrand } from './shared/branding'

describe('branding', () => {
  beforeEach(() => {
    document.head.innerHTML = '<link rel="icon" href="/icon-192.png" /><meta name="theme-color" content="#008069" /><meta name="apple-mobile-web-app-title" content="CRM" />'
    document.documentElement.classList.remove('dark')
    localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    applyBrand(DEFAULT_BRAND)
  })

  it('conserva los tonos de diseño del verde de la plataforma', () => {
    expect(brandShades('#00A884')).toEqual({ primary: '#00a884', strong: '#008069', deep: '#006e5b', dark: '#00a884' })
  })

  it('deriva encabezado y presionado de un color propio', () => {
    expect(brandShades('#1e40af')).toMatchObject({ primary: '#1e40af', strong: '#173185', deep: '#142a73' })
  })

  // Colores límite: claros (amarillo, celeste) que con la proporción fija
  // dejaban el texto blanco del botón primario por debajo de 4,5:1, y uno muy
  // oscuro que en tema oscuro no se leía sobre el fondo.
  it.each(['#f5c400', '#53bdeb', '#173185', '#00a884', '#ff6b6b'])(
    'con %s todos los tonos de texto llegan a 4,5:1',
    color => {
      const shades = brandShades(color)
      const soft = '#' + [1, 3, 5].map(i => Math.round(255 + (parseInt(shades.primary.slice(i, i + 2), 16) - 255) * 0.1).toString(16).padStart(2, '0')).join('')

      expect(contrastRatio(shades.strong, '#ffffff')).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(shades.deep, soft)).toBeGreaterThanOrEqual(4.5)
      expect(contrastRatio(shades.dark, '#11181d')).toBeGreaterThanOrEqual(4.5)
    },
  )

  it('no toca la marca que ya se lee bien en oscuro', () => {
    expect(brandShades('#53bdeb').dark).toBe('#53bdeb')
  })

  it('aplica nombre, color e ícono del negocio y los guarda para la próxima carga', () => {
    applyBrand({ name: 'Clínica Norte', primary_color: '#1e40af', logo_url: '/api/branding/logo?size=512&v=2', icon_url: '/api/branding/logo?size=192&v=2' })

    expect(document.title).toBe('Clínica Norte')
    expect(document.documentElement.style.getPropertyValue('--brand')).toBe('#1e40af')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#173185')
    expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toBe('/api/branding/logo?size=192&v=2')
    expect(currentBrandName()).toBe('Clínica Norte')
    expect(JSON.parse(localStorage.getItem('brand') ?? '{}').name).toBe('Clínica Norte')
  })

  it('sin respuesta del servidor se queda con la marca que ya tenía', async () => {
    applyBrand({ ...DEFAULT_BRAND, name: 'Clínica Norte' })
    vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new TypeError('offline'))

    await loadBrand()

    expect(currentBrandName()).toBe('Clínica Norte')
  })

  it('ignora una respuesta con un color inválido', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(JSON.stringify({ name: 'Otro', primary_color: 'red', logo_url: null, icon_url: null }), { status: 200 }),
    )

    await loadBrand()

    expect(currentBrandName()).toBe(DEFAULT_BRAND.name)
  })
})
